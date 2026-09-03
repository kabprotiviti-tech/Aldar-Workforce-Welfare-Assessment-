import {
  extractedFactStatusSchema,
  factAbsenceReasonSchema,
  factBboxSchema,
  factConfidenceSchema,
  type ExtractedFactStatus,
  type FactAbsenceReason,
  type FactBbox,
  type FactConfidence,
} from "@/lib/db/evidence";

/**
 * Pure logic for the fact ledger — the human gate between extraction and
 * everything downstream (this prompt). No database, no React: the rules
 * that decide what an assessor may bulk accept, what counts as
 * confirmed, and which page a fact came from are exactly the rules worth
 * proving in isolation, since a mistake in any of them either lets an
 * unreviewed value through or hides a reviewed one.
 */

export type FactValue = string | number | boolean | string[] | null;

/** One fact as the review list and the resolution actions both see it. */
export interface LedgerFact {
  id: string;
  evidenceFileId: string;
  factKey: string;
  /** What the model proposed. Kept even after an edit — it's the provenance behind verbatimQuote. */
  proposedValue: FactValue;
  /** What the system should consume: an assessor's edited value when edited, otherwise the proposal. */
  confirmedValue: FactValue;
  unit: string | null;
  pageRef: string | null;
  verbatimQuote: string | null;
  confidence: FactConfidence | null;
  status: ExtractedFactStatus;
  /** The model's reason for finding no value ('not_present'/'illegible'). */
  reason: FactAbsenceReason | null;
  /** An assessor's reason for rejecting the fact. */
  rejectionReason: string | null;
  bbox: FactBbox | null;
  resolvedAt: string | null;
  /** Which entry (e.g. room) this fact is about, for a document that lists many of the same kind of thing. Null for a document-wide fact. */
  groupRef: string | null;
}

/** Confirmed means a person accepted it or replaced it with their own value. Nothing else is consumable. */
export function isConfirmed(status: ExtractedFactStatus): boolean {
  return status === "accepted" || status === "edited";
}

/**
 * Bulk accept is restricted to high confidence (this prompt: "bulk accept
 * only for facts with high confidence"). Enforced here rather than only
 * in the UI so the server action can apply the same rule to whatever ids
 * a request actually carries.
 */
export function isBulkAcceptable(fact: LedgerFact): boolean {
  return fact.status === "proposed" && fact.confidence === "high";
}

export function bulkAcceptableIds(facts: LedgerFact[]): string[] {
  return facts.filter(isBulkAcceptable).map((fact) => fact.id);
}

export interface LedgerProgress {
  confirmed: number;
  total: number;
  rejected: number;
  pending: number;
}

export function ledgerProgress(facts: LedgerFact[]): LedgerProgress {
  return {
    confirmed: facts.filter((fact) => isConfirmed(fact.status)).length,
    total: facts.length,
    rejected: facts.filter((fact) => fact.status === "rejected").length,
    pending: facts.filter((fact) => fact.status === "proposed").length,
  };
}

/** The running count this prompt asks for, verbatim: "14 of 22 facts confirmed". */
export function progressLabel(progress: LedgerProgress): string {
  return `${progress.confirmed} of ${progress.total} facts confirmed`;
}

/**
 * Low confidence is visually separated and can't be bulk accepted (this
 * prompt) — so the split is data, not a styling detail buried in the
 * component. Medium stays in the main list: it's reviewable at a glance,
 * it just isn't eligible for bulk accept.
 */
export function partitionByConfidence(facts: LedgerFact[]): { primary: LedgerFact[]; lowConfidence: LedgerFact[] } {
  return {
    primary: facts.filter((fact) => fact.confidence !== "low"),
    lowConfidence: facts.filter((fact) => fact.confidence === "low"),
  };
}

/**
 * Which page of the document a fact came from, for "clicking a fact
 * scrolls the preview to that page" (this prompt). page_ref is free text
 * the model wrote, so this reads a page number out of the shapes that
 * actually occur ("page 1", "p. 3", "Page 5 of 40", a bare "7") and
 * prefers a number introduced by "page"/"p"/"pg" over a leading number
 * that belongs to something else ("Table 3, page 5" is page 5, not 3).
 */
export function parsePageRef(pageRef: string | null): number | null {
  if (!pageRef) return null;

  const labelled = /(?:pages?|pgs?|pp?)\.?\s*(\d+)/i.exec(pageRef);
  if (labelled) return Number(labelled[1]);

  const bare = /(\d+)/.exec(pageRef);
  return bare ? Number(bare[1]) : null;
}

const ABSENCE_LABELS: Record<FactAbsenceReason, string> = {
  not_present: "Not present in the document",
  illegible: "Illegible in the document",
};

/** How a fact's value reads in the review list. Absence is stated, never rendered as an empty cell. */
export function formatFactValue(value: FactValue, unit: string | null, reason: FactAbsenceReason | null): string {
  if (value === null) {
    return reason ? ABSENCE_LABELS[reason] : "No value";
  }
  const base = typeof value === "boolean" ? (value ? "Yes" : "No") : Array.isArray(value) ? value.join(", ") : String(value);
  return unit ? `${base} ${unit}` : base;
}

/** Turns a fact key into a readable label ("wps_transfer_date" -> "Wps transfer date") without a hand-maintained map per key. */
export function factKeyLabel(factKey: string): string {
  const words = factKey.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One extracted_facts row, as either Supabase (PostgREST/JSON) or
 * node-postgres hands it over — hence the loose types: `numeric` arrives
 * as a number from one and a string from the other, and `date` as a
 * string or a Date.
 */
export interface ExtractedFactRowLike {
  id: string;
  evidence_file_id: string;
  fact_key: string;
  value_text: string | null;
  value_number: number | string | null;
  value_date: string | Date | null;
  value_boolean: boolean | null;
  value_json: unknown;
  unit: string | null;
  page_ref: string | null;
  verbatim_quote: string | null;
  confidence: string | null;
  status: string;
  reason: string | null;
  rejection_reason: string | null;
  resolved_value_json: unknown;
  bbox: unknown;
  resolved_at: string | Date | null;
  group_ref: string | null;
}

function isoDate(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

/**
 * Which of the typed value_* columns actually holds this fact's value.
 * Exactly one is populated per row by construction (factToInsert,
 * lib/ai/extract.ts) — or none, when the model reported an absence.
 */
export function proposedValueOf(row: ExtractedFactRowLike): FactValue {
  if (row.value_text !== null) return row.value_text;
  if (row.value_number !== null) return Number(row.value_number);
  if (row.value_date !== null) return isoDate(row.value_date);
  if (row.value_boolean !== null) return row.value_boolean;
  if (Array.isArray(row.value_json)) return row.value_json.map((entry) => String(entry));
  return null;
}

/**
 * The value the system should consume. Mirrors 0021_fact_ledger.sql's
 * `confirmed_value` precedence in TypeScript — an edited fact's human
 * value wins over the model's original proposal — so the review list and
 * the downstream view can never disagree about what a fact's value is.
 */
export function confirmedValueOf(row: ExtractedFactRowLike): FactValue {
  if (row.status === "edited" && row.resolved_value_json && typeof row.resolved_value_json === "object") {
    const envelope = row.resolved_value_json as { value?: unknown };
    if ("value" in envelope) {
      const value = envelope.value;
      if (Array.isArray(value)) return value.map((entry) => String(entry));
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    }
  }
  return proposedValueOf(row);
}

export function ledgerFactFromRow(row: ExtractedFactRowLike): LedgerFact {
  const confidence = factConfidenceSchema.safeParse(row.confidence);
  const reason = factAbsenceReasonSchema.safeParse(row.reason);
  const status = extractedFactStatusSchema.safeParse(row.status);
  const bbox = factBboxSchema.safeParse(row.bbox);

  return {
    id: row.id,
    evidenceFileId: row.evidence_file_id,
    factKey: row.fact_key,
    proposedValue: proposedValueOf(row),
    confirmedValue: confirmedValueOf(row),
    unit: row.unit,
    pageRef: row.page_ref,
    verbatimQuote: row.verbatim_quote,
    confidence: confidence.success ? confidence.data : null,
    // A row whose status isn't in the known vocabulary is treated as
    // unreviewed rather than silently confirmed — the safe direction.
    status: status.success ? status.data : "proposed",
    reason: reason.success ? reason.data : null,
    rejectionReason: row.rejection_reason,
    bbox: bbox.success ? bbox.data : null,
    resolvedAt: row.resolved_at ? (row.resolved_at instanceof Date ? row.resolved_at.toISOString() : row.resolved_at) : null,
    groupRef: row.group_ref,
  };
}

export type CoerceEditResult = { ok: true; value: FactValue } | { ok: false; message: string };

/**
 * An edit arrives from a text input as a string, but the fact it
 * replaces has a type the rule engine will later compare numerically or
 * as a date. Coercing the human's text to the *proposed value's* type
 * keeps an edited fact consumable by the same code as an accepted one —
 * without this, editing a count from 42 to 43 would quietly turn a
 * number into the string "43".
 */
export function coerceEditedValue(raw: string, proposedValue: FactValue): CoerceEditResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Enter a value, or reject the fact instead." };
  }

  if (typeof proposedValue === "number") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return { ok: false, message: `"${trimmed}" isn't a number.` };
    }
    return { ok: true, value: parsed };
  }

  if (typeof proposedValue === "boolean") {
    const normalized = trimmed.toLowerCase();
    if (["yes", "true", "y"].includes(normalized)) return { ok: true, value: true };
    if (["no", "false", "n"].includes(normalized)) return { ok: true, value: false };
    return { ok: false, message: `"${trimmed}" isn't yes or no.` };
  }

  if (Array.isArray(proposedValue)) {
    const entries = trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length === 0) {
      return { ok: false, message: "Enter a comma-separated list, or reject the fact instead." };
    }
    return { ok: true, value: entries };
  }

  return { ok: true, value: trimmed };
}
