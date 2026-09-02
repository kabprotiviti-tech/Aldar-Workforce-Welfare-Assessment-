import type { RuleInputs, RuleResult } from "@/lib/rules/compliance/types";

/**
 * Reading a rule's declared inputs, and the one thing every rule must do
 * identically: when an input is absent, return insufficient_data naming
 * the key that was missing (this prompt's acceptance criterion) rather
 * than guessing, defaulting to zero, or falling through to a pass.
 */

export interface Requirement<T> {
  source: "fact" | "quantitative";
  key: string;
  parse: (raw: unknown) => T | null;
}

/** A value read from fact_ledger_confirmed. */
export function fact<T>(key: string, parse: (raw: unknown) => T | null): Requirement<T> {
  return { source: "fact", key, parse };
}

/** An assessor-entered quantitative value. */
export function quant<T>(key: string, parse: (raw: unknown) => T | null): Requirement<T> {
  return { source: "quantitative", key, parse };
}

type Resolved<S> = { [K in keyof S]: S[K] extends Requirement<infer T> ? T : never };

export type RequireResult<S> = { ok: true; values: Resolved<S> } | { ok: false; missing: string[] };

function rawValue(inputs: RuleInputs, requirement: Requirement<unknown>): unknown {
  return requirement.source === "fact" ? inputs.facts[requirement.key] : inputs.quantitative[requirement.key];
}

/**
 * Reads every requirement, or reports all of the missing keys at once —
 * all of them, not just the first, so an assessor is told everything the
 * rule still needs in one pass.
 *
 * A key counts as missing when it is absent, when its confirmed value is
 * null (a person confirmed the document doesn't state it — real
 * information, but still not a value this rule can compute with), or when
 * it is present in a shape the rule can't use. `false` and `0` are values,
 * not absences.
 */
export function requireAll<S extends Record<string, Requirement<unknown>>>(inputs: RuleInputs, spec: S): RequireResult<S> {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const [name, requirement] of Object.entries(spec)) {
    const raw = rawValue(inputs, requirement);
    const parsed = raw === undefined || raw === null ? null : requirement.parse(raw);
    if (parsed === null) {
      missing.push(requirement.key);
    } else {
      values[name] = parsed;
    }
  }

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, values: values as Resolved<S> };
}

/** Optional input: absent or unusable becomes null rather than blocking the rule. */
export function optional<T>(inputs: RuleInputs, requirement: Requirement<T>): T | null {
  const raw = rawValue(inputs, requirement);
  if (raw === undefined || raw === null) return null;
  return requirement.parse(raw);
}

/**
 * The one shape of insufficient_data every rule uses. The explanation
 * says outright that this is not a pass, because the whole point of the
 * result existing is that nobody downstream — or reading a report — can
 * mistake "we couldn't tell" for "it was fine".
 */
export function insufficientData(missing: string[], detail?: string): RuleResult {
  const missingClause = missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
  const detailClause = detail ? ` ${detail}` : "";
  return {
    outcome: "insufficient_data",
    computedExplanation: `Insufficient data — this rule could not be evaluated and is not a pass.${missingClause}${detailClause}`,
    missingKeys: [...missing],
    observed: {},
  };
}

// ---------------------------------------------------------------------------
// Parsers. Each returns null for "present but not usable as this type",
// which requireAll treats the same as absent — the rule can't compute
// either way, and saying which key is at fault is what matters.
// ---------------------------------------------------------------------------

export function asNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asInteger(raw: unknown): number | null {
  const parsed = asNumber(raw);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function asBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["yes", "true", "y", "present"].includes(normalized)) return true;
    if (["no", "false", "n", "absent"].includes(normalized)) return false;
  }
  return null;
}

export function asString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** An ISO yyyy-mm-dd date. Rejects anything else rather than letting Date's lenient parsing invent a day. */
export function asIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return trimmed;
}

/** A yyyy-mm wage period. */
export function asIsoMonth(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  const month = Number(trimmed.slice(5, 7));
  return month >= 1 && month <= 12 ? trimmed : null;
}

export function asStringList(raw: unknown): string[] | null {
  if (Array.isArray(raw)) {
    const entries = raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : null;
  }
  if (typeof raw === "string") {
    const entries = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : null;
  }
  return null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days from `from` to `to`, positive when `to` is later. Both ISO yyyy-mm-dd, compared in UTC so no timezone shifts a date. */
export function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * Normalizes a free-text label for comparison against a fixed threshold
 * list: "Emirates ID" and "emirates-id" both become "emirates_id". The
 * model and assessors write these by hand, so matching raw strings would
 * make a threshold list fail for punctuation reasons.
 */
export function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Whether a normalized label names a listed term — as the whole label, or
 * as a whole word within it, so "PPE charges" is recognised as a PPE
 * deduction. Whole-word only: "transportation_allowance" must not match a
 * "transport" prohibition, because an allowance is not a deduction.
 *
 * The term is escaped before it reaches a regex: threshold lists are
 * admin-editable, so a term like "work.permit" must be matched literally
 * rather than compiled as a pattern.
 */
export function labelMatches(label: string, term: string): boolean {
  const normalizedLabel = normalizeLabel(label);
  const normalizedTerm = normalizeLabel(term);
  if (normalizedLabel === normalizedTerm) return true;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|_)${escaped}(_|$)`).test(normalizedLabel);
}
