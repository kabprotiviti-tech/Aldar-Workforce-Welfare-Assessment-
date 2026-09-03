import { buildPhotoSystemPrompt, buildPhotoUserText, promptVersion } from "@/lib/ai/prompts/photo/v1";
import { stripStatusLikeKeys } from "@/lib/observations/kinds";
import { getPhotoClass, type FieldKind, type PhotoClass } from "@/lib/vision/classes";
import { derivedFactFor, type DerivedValueType } from "@/lib/vision/derived-facts";
import { responseSchemaFor, type ObservedState } from "@/lib/vision/schema";
import { containsUndeterminableClaim, stripUndeterminableKeys } from "@/lib/vision/undeterminable";
import type { FactConfidence } from "@/lib/db/evidence";

/**
 * Analysing one inspection photograph (this prompt).
 *
 * Pure over an injected model call, no "server-only" — the adapter is
 * lib/vision/analyse-supabase.ts. What that buys is the ability to prove,
 * without a network or a database, the thing this feature is actually
 * about: that a bedroom photograph cannot yield a floor area or a
 * per-person value, whatever the model returns.
 *
 * Four guards run over every response, in this order:
 *   1. status-like keys are stripped (lib/observations/kinds.ts) — the
 *      analysis produces observations, never a status.
 *   2. undeterminable keys are stripped (lib/vision/undeterminable.ts).
 *   3. the response is validated against the class's closed field
 *      vocabulary, strictly — an unknown field is a failed response.
 *   4. each reading is reduced to the properties its field's kind
 *      actually has, and free text making an undeterminable claim is
 *      removed.
 *
 * Everything removed is recorded in `suppressed` and reflected in
 * `cannotDetermine`, rather than silently dropped.
 */

export interface PhotoImage {
  mediaType: "image/jpeg" | "image/png";
  base64Data: string;
}

export interface AnalysePhotoInput {
  photoId: string;
  photoClass: PhotoClass;
  /** The room the assessor recorded the photograph against, for context only. */
  roomRef: string | null;
  image: PhotoImage;
}

export interface CallVisionResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type CallVisionFn = (input: { systemPrompt: string; userText: string; image: PhotoImage }) => Promise<CallVisionResult>;

/** What the assessor may confirm this reading into, when the reading is a piece of printed text. */
export interface DerivedFactCandidate {
  /** The fact keys the reading may be recorded under. More than one means the assessor chooses. */
  factKeyChoices: readonly string[];
  valueType: DerivedValueType;
  label: string;
  /** The model's verbatim reading, which is what the assessor checks against the image. */
  verbatimText: string;
}

export interface AnalysedReading {
  field: string;
  kind: FieldKind;
  /** The field's description, so the review panel labels it without re-stating the vocabulary. */
  description: string;
  observed: ObservedState;
  countInFrame: number | null;
  values: string[];
  verbatimText: string | null;
  condition: string | null;
  confidence: FactConfidence;
  derivedFact: DerivedFactCandidate | null;
}

export interface PhotoAnalysisResult {
  photoId: string;
  photoClass: PhotoClass;
  readings: AnalysedReading[];
  /** Always non-empty: the class's standing caveats are added by code. */
  cannotDetermine: string[];
  /** What the guards removed, as dotted paths or short notes. */
  suppressed: string[];
  rawResponse: unknown;
  promptVersion: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * The caveats code adds regardless of what the model said (this prompt:
 * area, dimensions, per-person ratios, temperature, water quality and
 * occupancy totals "must always appear in cannot_determine when
 * relevant"). Relevance is decided by the class, and by whether a count
 * in frame was actually reported — a count is the reading most likely to
 * be misread as a total, so it earns its own caveat when it appears.
 */
export function mandatoryCaveats(photoClass: PhotoClass, readings: AnalysedReading[]): string[] {
  const definition = getPhotoClass(photoClass)!;
  const caveats = [...definition.alwaysCannotDetermine];

  for (const reading of readings) {
    if (reading.kind !== "count_in_frame" || reading.countInFrame === null) continue;
    const field = definition.fields.find((entry) => entry.key === reading.field)!;
    caveats.push(`${reading.countInFrame} visible in this frame is not ${field.notATotalOf} — the photograph shows the frame, not the whole.`);
  }

  return caveats;
}

/**
 * Reduces one reading to the properties its field's kind actually has.
 *
 * This is where a room photograph stops being able to carry a
 * measurement: `verbatim_text` is nulled on every field that is not a
 * verbatim text reading, and room_general has none. A model that writes
 * "floor area approx 24 m²" into a bedroom reading loses it here, and
 * again in the free-text guard below if it puts it in `condition`.
 */
function normaliseReading(
  photoClass: PhotoClass,
  raw: { field: string; observed: ObservedState; count_in_frame: number | null; values: string[] | null; verbatim_text: string | null; condition: string | null; confidence: FactConfidence },
  suppressed: string[],
): AnalysedReading {
  const definition = getPhotoClass(photoClass)!;
  const field = definition.fields.find((entry) => entry.key === raw.field)!;

  const countInFrame = field.kind === "count_in_frame" ? raw.count_in_frame : null;
  if (raw.count_in_frame !== null && field.kind !== "count_in_frame") {
    suppressed.push(`${raw.field}.count_in_frame (${field.kind} field)`);
  }

  const allowed = new Set(field.allowedValues ?? []);
  const values = field.kind === "list" ? (raw.values ?? []).filter((value) => allowed.has(value)) : [];
  if (field.kind === "list") {
    for (const value of raw.values ?? []) {
      if (!allowed.has(value)) suppressed.push(`${raw.field}.values: "${value}" is not in the closed list`);
    }
  } else if (raw.values !== null && raw.values.length > 0) {
    suppressed.push(`${raw.field}.values (${field.kind} field)`);
  }

  let verbatimText: string | null = null;
  if (field.kind === "text") {
    verbatimText = raw.verbatim_text;
  } else if (raw.verbatim_text !== null) {
    suppressed.push(`${raw.field}.verbatim_text (${field.kind} field reads no text)`);
  }

  let condition = raw.condition;
  if (condition !== null && containsUndeterminableClaim(condition)) {
    suppressed.push(`${raw.field}.condition: made a claim a photograph cannot support`);
    condition = null;
  }

  const derived = derivedFactFor(photoClass, field.key);

  return {
    field: field.key,
    kind: field.kind,
    description: field.description,
    observed: raw.observed,
    countInFrame,
    values,
    verbatimText,
    condition,
    confidence: raw.confidence,
    derivedFact:
      derived && verbatimText !== null && raw.observed === "present"
        ? { factKeyChoices: derived.factKeyChoices, valueType: derived.valueType, label: derived.label, verbatimText }
        : null,
  };
}

/**
 * Analyses one photograph. Never throws: a malformed or hostile response
 * produces an error and no readings, the same posture as the extraction
 * service and the observation generator.
 */
export async function analysePhoto(callVision: CallVisionFn, input: AnalysePhotoInput): Promise<PhotoAnalysisResult> {
  const definition = getPhotoClass(input.photoClass);
  const base = {
    photoId: input.photoId,
    photoClass: input.photoClass,
    readings: [] as AnalysedReading[],
    suppressed: [] as string[],
    rawResponse: null as unknown,
    promptVersion,
    model: "",
    inputTokens: 0,
    outputTokens: 0,
  };

  if (!definition) {
    return { ...base, cannotDetermine: [], error: `${input.photoClass} is not a photograph class this platform analyses.` };
  }

  // Even a failed analysis says what a photograph of this class cannot
  // establish. That is the part an assessor most needs, and it does not
  // depend on the model having answered.
  const classCaveats = [...definition.alwaysCannotDetermine];

  let call: CallVisionResult;
  try {
    call = await callVision({
      systemPrompt: buildPhotoSystemPrompt(input.photoClass),
      userText: buildPhotoUserText(input.photoClass, input.roomRef),
      image: input.image,
    });
  } catch (err) {
    return { ...base, cannotDetermine: classCaveats, error: err instanceof Error ? err.message : String(err) };
  }

  const withCall = { ...base, model: call.model, inputTokens: call.inputTokens, outputTokens: call.outputTokens };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(call.text));
  } catch (err) {
    return {
      ...withCall,
      rawResponse: call.text,
      cannotDetermine: classCaveats,
      error: `The model's response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const statusStrip = stripStatusLikeKeys(parsed);
  const claimStrip = stripUndeterminableKeys(statusStrip.value);
  const suppressed = [
    ...statusStrip.strippedPaths.map((path) => `${path}: a status-like key, which an analysis may never carry`),
    ...claimStrip.strippedPaths.map((path) => `${path}: a claim a photograph cannot support`),
  ];

  const validated = responseSchemaFor(input.photoClass).safeParse(claimStrip.value);
  if (!validated.success) {
    return {
      ...withCall,
      rawResponse: parsed,
      suppressed,
      cannotDetermine: classCaveats,
      error: `The model's response did not match the expected shape: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    };
  }

  // First reading per field wins: a second reading of the same field is
  // a contradiction the model should not have produced, and picking the
  // later one would silently prefer whichever it wrote last.
  const seen = new Set<string>();
  const readings: AnalysedReading[] = [];
  for (const raw of validated.data.readings) {
    if (seen.has(raw.field)) {
      suppressed.push(`${raw.field}: reported more than once, later readings ignored`);
      continue;
    }
    seen.add(raw.field);
    readings.push(normaliseReading(input.photoClass, raw, suppressed));
  }

  const modelCaveats = validated.data.cannot_determine.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const cannotDetermine = [...new Set([...mandatoryCaveats(input.photoClass, readings), ...modelCaveats])];

  return { ...withCall, readings, cannotDetermine, suppressed, rawResponse: parsed, error: null };
}
