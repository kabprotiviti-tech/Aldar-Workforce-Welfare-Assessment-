/**
 * The guards behind this prompt's central constraint: area, dimensions,
 * per-person ratios, temperature, water quality and occupancy totals
 * cannot be determined from a photograph.
 *
 * The prompt says so (lib/ai/prompts/photo/v1.ts) and the response schema
 * has no field for any of them (lib/vision/schema.ts). Neither is
 * enforcement. These two functions are — they run over what the model
 * actually returned, and what they find is removed rather than argued
 * with, in the same posture as lib/ai/forbidden-fields.ts.
 */

/**
 * Key names that would carry an undeterminable claim. Matched as whole
 * words against every object key at every depth, after the key is broken
 * into words — so "floorArea", "floor_area", "FLOOR-AREA" and "area_m2"
 * are all the same thing.
 *
 * Whole words, not substrings: "registration" contains the letters of
 * "ratio", and a substring match would quietly delete
 * vehicle_registration_expiry_date.
 */
const UNDETERMINABLE_KEY_PATTERNS: readonly RegExp[] = [
  /\b(?:areas?|dimensions?|widths?|lengths?|heights?|sqm|sqft|m2|ft2|volumes?|cubic)\b/,
  /\bsquare\s+(?:met(?:re|er)s?|feet|foot)\b/,
  /\bper\s+(?:person|people|resident|occupant|worker|head|capita|man|bed)\b/,
  /\bratios?\b/,
  /\btemperatures?\b/,
  /\bdegrees?\s*(?:c|f|celsius|fahrenheit)\b/,
  /\bwater\s+quality\b/,
  /\boccupancy\b/,
  /\boccupants?\b/,
  /\bheadcounts?\b/,
  /\bcapacity\b/,
];

/** Breaks a key into space-separated lowercase words: "floorAreaM2" -> "floor area m2". */
function keyWords(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function isUndeterminableKey(key: string): boolean {
  const words = keyWords(key);
  return UNDETERMINABLE_KEY_PATTERNS.some((pattern) => pattern.test(words));
}

/**
 * A dotted path to the first key anywhere in the value that would carry
 * an undeterminable claim, or null. The count_in_frame fields are named
 * `*_in_frame` precisely so they read as what is visible rather than as
 * a total, and they contain none of the terms above.
 */
export function findUndeterminableKey(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findUndeterminableKey(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isUndeterminableKey(key)) {
        return childPath;
      }
      const found = findUndeterminableKey(child, childPath);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Free text is the other way an undeterminable claim gets in: not as a
 * field called `floor_area` but as a condition reading that says "room
 * appears to be around 20 m² for 8 men". The schema cannot catch that,
 * so this does.
 *
 * Matched narrowly — a measurement, a ratio, a temperature or an
 * occupancy claim — rather than on the bare words, so a legitimate
 * reading like "surfaces worn, one panel missing" is untouched.
 */
const UNDETERMINABLE_TEXT_PATTERNS: readonly RegExp[] = [
  // A number with an area or dimension unit: 24 m2, 24m², 3.5 x 4 m, 260 sq ft.
  /\d\s*(?:x|×|by)\s*\d+(?:\.\d+)?\s*(?:met(?:re|er)s?|feet|ft|m)\b/i,
  /\d\s*(?:square\s*(?:met(?:re|er)s?|feet|foot)|sq\.?\s*(?:m|ft)\b|m\s*²|m\s*2(?![0-9a-z])|㎡)/i,
  // A per-person claim, with or without a number.
  /\bper\s+(?:person|resident|occupant|worker|head|capita|man|bed)\b/i,
  // A temperature.
  /\d\s*(?:°|deg(?:rees)?\b)\s*(?:c|f|celsius|fahrenheit)?/i,
  // An occupancy or capacity total, as opposed to what is in frame.
  /\b(?:occupancy|occupants?|capacity|sleeps|accommodates|houses)\b\s*(?:of|is|:)?\s*\d/i,
  /\b\d+\s*(?:men|workers|residents|people|persons|occupants)\b/i,
  // An explicit ratio.
  /\b\d+\s*(?::|to)\s*\d+\s*ratio\b/i,
  /\bratio\s+of\s+\d/i,
];

/** True when a free-text reading makes a claim a photograph cannot support. */
export function containsUndeterminableClaim(text: string): boolean {
  return UNDETERMINABLE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

export interface StripResult<T> {
  value: T;
  /** Dotted paths of the keys removed, for the caller to record. */
  strippedPaths: string[];
}

/**
 * Removes any undeterminable-claim key from a model response,
 * recursively, and reports what it removed.
 *
 * Runs before schema validation for the same reason the status-key strip
 * does (lib/observations/kinds.ts): the response schema is strict, so a
 * stray `floor_area_m2` would fail the whole analysis and lose every
 * legitimate reading with it. Stripping first keeps the usable readings,
 * records the attempt, and leaves nothing for a consumer to find.
 */
export function stripUndeterminableKeys<T>(value: T): StripResult<T> {
  const strippedPaths: string[] = [];
  return { value: walk(value, "", strippedPaths) as T, strippedPaths };
}

function walk(value: unknown, path: string, stripped: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => walk(entry, `${path}[${index}]`, stripped));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isUndeterminableKey(key)) {
        stripped.push(childPath);
        continue;
      }
      result[key] = walk(child, childPath, stripped);
    }
    return result;
  }
  return value;
}
