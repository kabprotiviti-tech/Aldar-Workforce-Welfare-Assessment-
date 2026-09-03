/**
 * Unit conversion for room measurements printed on approved drawings.
 *
 * The model is never asked to convert units (this prompt: "does not
 * convert units"). It reports the number and the unit exactly as
 * printed; every conversion between what was printed and square metres
 * happens here, in code, so it can be tested and so a wrong reading is a
 * wrong lookup in a table, not a silent arithmetic mistake inside a model
 * response.
 *
 * Unrecognised spellings are refused rather than guessed at: a null
 * return means "this platform doesn't know what unit that is", which is
 * exactly the honest degradation this feature asks for.
 */

const AREA_UNIT_TO_M2: Readonly<Record<string, number>> = {
  m2: 1,
  "m^2": 1,
  sqm: 1,
  "sq.m": 1,
  "sq m": 1,
  "sqmt": 1,
  "square metre": 1,
  "square metres": 1,
  "square meter": 1,
  "square meters": 1,
  ft2: 0.09290304,
  "ft^2": 0.09290304,
  sqft: 0.09290304,
  "sq.ft": 0.09290304,
  "sq ft": 0.09290304,
  "square foot": 0.09290304,
  "square feet": 0.09290304,
};

const LENGTH_UNIT_TO_M: Readonly<Record<string, number>> = {
  m: 1,
  metre: 1,
  metres: 1,
  meter: 1,
  meters: 1,
  cm: 0.01,
  centimetre: 0.01,
  centimetres: 0.01,
  mm: 0.001,
  millimetre: 0.001,
  millimetres: 0.001,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  "'": 0.3048,
  in: 0.0254,
  inch: 0.0254,
  inches: 0.0254,
  '"': 0.0254,
};

function normaliseUnit(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Converts a printed area figure to square metres, or null when the unit isn't one this platform recognises. */
export function areaToM2(value: number, unit: string): number | null {
  const factor = AREA_UNIT_TO_M2[normaliseUnit(unit)];
  return factor === undefined ? null : value * factor;
}

/** Converts a printed length figure to metres, or null when the unit isn't one this platform recognises. */
export function lengthToM(value: number, unit: string): number | null {
  const factor = LENGTH_UNIT_TO_M[normaliseUnit(unit)];
  return factor === undefined ? null : value * factor;
}

export function isKnownAreaUnit(unit: string): boolean {
  return normaliseUnit(unit) in AREA_UNIT_TO_M2;
}

export function isKnownLengthUnit(unit: string): boolean {
  return normaliseUnit(unit) in LENGTH_UNIT_TO_M;
}
