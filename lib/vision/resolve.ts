import { asIsoDate } from "@/lib/rules/compliance/inputs";
import { derivedFactFor, PHOTO_DERIVED_FACT_KEYS } from "@/lib/vision/derived-facts";
import type { AnalysedReading } from "@/lib/vision/analyse";
import type { PhotoClass } from "@/lib/vision/classes";
import type { FactConfidence } from "@/lib/db/evidence";

/**
 * Turning an assessor's decision on one photograph analysis into what
 * the database is asked to write (this prompt: "the assessor sees the
 * analysis beside the photo and accepts, edits or rejects", and "a
 * photo-derived date becomes a fact only after assessor confirmation").
 *
 * Pure, so the rules about what may become a fact are provable without a
 * database. The database enforces the same rules again from the other
 * side: resolve_photo_analysis refuses facts on a rejection, and a
 * trigger refuses any fact key a photograph may not produce
 * (0026_photo_analysis.sql).
 */

export type AnalysisAction = "accept" | "edit" | "reject";

/** One reading the assessor chose to record as a fact. */
export interface ConfirmedReading {
  field: string;
  /** Which key to record it under. Must be one the reading's own definition offers. */
  factKey: string;
  /**
   * The value the assessor entered. For a date reading this is an ISO
   * date they read off the photograph themselves — the model returns the
   * date only as printed, because resolving "12/03/27" is a judgement
   * about the document, not a reading of it.
   */
  value: string;
}

export interface ResolveAnalysisInput {
  analysisId: string;
  photoClass: PhotoClass;
  /** The analysis as stored, which is what the assessor was shown. */
  readings: readonly AnalysedReading[];
  action: AnalysisAction;
  /** Required on a rejection, and this prompt requires it be retained. */
  rejectionReason?: string;
  /** The assessor's corrected readings, on an edit. */
  editedReadings?: readonly AnalysedReading[];
  /** Readings the assessor confirmed into facts. Empty is normal — most readings are observations. */
  confirmed?: readonly ConfirmedReading[];
}

/** One row for resolve_photo_analysis to insert into extracted_facts. */
export interface DerivedFactRow {
  fact_key: string;
  value_text: string | null;
  value_date: string | null;
  unit: null;
  verbatim_quote: string;
  confidence: FactConfidence;
}

export interface ResolveAnalysisPlan {
  analysisId: string;
  status: "accepted" | "edited" | "rejected";
  editedFindings: readonly AnalysedReading[] | null;
  rejectionReason: string | null;
  derivedFacts: DerivedFactRow[];
}

export type ResolveAnalysisResult = { ok: true; plan: ResolveAnalysisPlan } | { ok: false; message: string };

const STATUS_BY_ACTION = { accept: "accepted", edit: "edited", reject: "rejected" } as const;

export function planAnalysisResolution(input: ResolveAnalysisInput): ResolveAnalysisResult {
  const confirmed = input.confirmed ?? [];

  if (input.action === "reject") {
    if ((input.rejectionReason ?? "").trim().length === 0) {
      return { ok: false, message: "Say why you are rejecting this analysis. The reason is kept with it." };
    }
    if (confirmed.length > 0) {
      // A rejected analysis is retained with its reason and excluded
      // from the report (this prompt). Letting it also produce a fact
      // would be exactly the contradiction the review exists to prevent.
      return { ok: false, message: "A rejected analysis cannot also produce a confirmed fact." };
    }
    return {
      ok: true,
      plan: {
        analysisId: input.analysisId,
        status: "rejected",
        editedFindings: null,
        rejectionReason: input.rejectionReason!.trim(),
        derivedFacts: [],
      },
    };
  }

  if (input.action === "edit" && (input.editedReadings === undefined || input.editedReadings.length === 0)) {
    return { ok: false, message: "An edit needs the corrected readings." };
  }

  const source = input.action === "edit" ? input.editedReadings! : input.readings;
  const byField = new Map(source.map((reading) => [reading.field, reading]));
  const derivedFacts: DerivedFactRow[] = [];
  const usedFields = new Set<string>();

  for (const entry of confirmed) {
    if (usedFields.has(entry.field)) {
      return { ok: false, message: `${entry.field} was confirmed twice.` };
    }
    usedFields.add(entry.field);

    const reading = byField.get(entry.field);
    if (!reading) {
      return { ok: false, message: `${entry.field} is not part of this analysis.` };
    }

    const definition = derivedFactFor(input.photoClass, entry.field);
    if (!definition || reading.derivedFact === null) {
      // Only a verbatim reading of printed text may become a fact. A
      // presence, a count in frame or a condition is an observation for
      // an assessor to weigh, and there is no key to record it under.
      return { ok: false, message: `${entry.field} is an observation, not a reading that can become a fact.` };
    }

    if (!definition.factKeyChoices.includes(entry.factKey)) {
      return { ok: false, message: `${entry.factKey} is not a fact key this reading can be recorded under.` };
    }
    // Belt and braces against the code path above being changed later:
    // the same list the database trigger enforces.
    if (!PHOTO_DERIVED_FACT_KEYS.includes(entry.factKey)) {
      return { ok: false, message: `${entry.factKey} is not a fact key a photograph may produce.` };
    }

    if (definition.valueType === "date") {
      const iso = asIsoDate(entry.value);
      if (iso === null) {
        return { ok: false, message: `Enter ${definition.label.toLowerCase()} as a date (YYYY-MM-DD), read from the photograph.` };
      }
      derivedFacts.push({
        fact_key: entry.factKey,
        value_text: null,
        value_date: iso,
        unit: null,
        verbatim_quote: reading.derivedFact.verbatimText,
        confidence: reading.confidence,
      });
      continue;
    }

    const text = entry.value.trim();
    if (text.length === 0) {
      return { ok: false, message: `${definition.label} cannot be recorded as an empty value.` };
    }
    derivedFacts.push({
      fact_key: entry.factKey,
      value_text: text,
      value_date: null,
      unit: null,
      verbatim_quote: reading.derivedFact.verbatimText,
      confidence: reading.confidence,
    });
  }

  return {
    ok: true,
    plan: {
      analysisId: input.analysisId,
      status: STATUS_BY_ACTION[input.action],
      editedFindings: input.action === "edit" ? input.editedReadings! : null,
      rejectionReason: null,
      derivedFacts,
    },
  };
}
