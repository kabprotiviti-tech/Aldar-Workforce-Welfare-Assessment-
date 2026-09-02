import { z } from "zod";
import { asInteger, asIsoDate, asNumber, daysBetween, fact, insufficientData, optional, quant, requireAll } from "@/lib/rules/compliance/inputs";
import { formatComparable, formatFixed, formatNumber, listPhrase, pluralize, renderTemplate } from "@/lib/rules/compliance/format";
import { defineRule, type RuleInputs } from "@/lib/rules/compliance/types";

/**
 * Accommodation: room area and headcount, the civil defence certificate
 * (all under checklist requirement 18) and the CD13 sanitary ratios.
 *
 * Room area and occupancy each have two possible sources — the approved
 * drawing the model read, and the assessor's own measurement on site.
 * The assessor's figure wins where both exist, matching what
 * rooms.computed_m2_per_person already does in the database
 * (0006_rules_measurement.sql: coalesce(measured_area_m2, drawing_area_m2)).
 */

function roomArea(inputs: RuleInputs): number | null {
  return optional(inputs, quant("room_area_m2", asNumber)) ?? optional(inputs, fact("drawing_room_area_m2", asNumber));
}

function roomOccupancy(inputs: RuleInputs): number | null {
  return optional(inputs, quant("room_occupancy", asInteger)) ?? optional(inputs, fact("occupancy_headcount", asInteger));
}

// ---------------------------------------------------------------------------
// R18_ROOM_AREA — area_m2 / occupancy >= 4.00
// ---------------------------------------------------------------------------

const roomAreaThresholds = z.object({
  minAreaPerResidentM2: z.number().min(0),
});

const ROOM_AREA_TEMPLATE =
  "{area} m² / {occupancy} residents = {perResident} m² per resident. Minimum {minimum} m². {verdict}.";

export const R18_ROOM_AREA = defineRule({
  code: "R18_ROOM_AREA",
  title: "Floor area per resident meets the minimum",
  module: "employment_practices",
  requirementSlNo: 18,
  inputFactKeys: ["drawing_room_area_m2", "occupancy_headcount"],
  quantitativeKeys: ["room_area_m2", "room_occupancy"],
  defaultThresholds: { minAreaPerResidentM2: 4 },
  thresholdsSchema: roomAreaThresholds,
  legalReference:
    "WWAP checklist requirement 18 (Decent accommodation and food). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: ROOM_AREA_TEMPLATE,
  evaluate(inputs, thresholds) {
    const area = roomArea(inputs);
    const occupancy = roomOccupancy(inputs);

    const missing: string[] = [];
    if (area === null) missing.push("room_area_m2 or drawing_room_area_m2");
    if (occupancy === null) missing.push("room_occupancy or occupancy_headcount");
    if (missing.length > 0) return insufficientData(missing);

    // An empty room has no area *per resident* to compare: not a pass, not
    // a fail — the measurement doesn't exist. Named separately from a
    // missing input because the occupancy figure was supplied.
    if (occupancy! <= 0) {
      return insufficientData([], `Recorded occupancy is ${occupancy}, so area per resident cannot be calculated.`);
    }

    const perResident = area! / occupancy!;
    const meets = perResident >= thresholds.minAreaPerResidentM2;

    return {
      outcome: meets ? "pass" : "fail",
      computedExplanation: renderTemplate(ROOM_AREA_TEMPLATE, {
        area: formatNumber(area!),
        occupancy: occupancy!,
        // Shown at whatever precision keeps the figure from *looking*
        // equal to a minimum it actually falls short of.
        perResident: formatComparable(perResident, thresholds.minAreaPerResidentM2),
        minimum: formatFixed(thresholds.minAreaPerResidentM2),
        verdict: meets ? "Meets threshold" : "Below threshold",
      }),
      missingKeys: [],
      observed: { area, occupancy, perResident, minimum: thresholds.minAreaPerResidentM2 },
    };
  },
});

// ---------------------------------------------------------------------------
// R18_ROOM_HEADCOUNT — occupancy <= 8
// ---------------------------------------------------------------------------

const roomHeadcountThresholds = z.object({
  maxResidentsPerRoom: z.number().int().min(1),
});

const ROOM_HEADCOUNT_TEMPLATE = "{occupancy} residents in the room against a maximum of {maximum}. {verdict}.";

export const R18_ROOM_HEADCOUNT = defineRule({
  code: "R18_ROOM_HEADCOUNT",
  title: "Residents per room within the maximum",
  module: "employment_practices",
  requirementSlNo: 18,
  inputFactKeys: ["occupancy_headcount"],
  quantitativeKeys: ["room_occupancy"],
  defaultThresholds: { maxResidentsPerRoom: 8 },
  thresholdsSchema: roomHeadcountThresholds,
  legalReference:
    "WWAP checklist requirement 18 (Decent accommodation and food). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: ROOM_HEADCOUNT_TEMPLATE,
  evaluate(inputs, thresholds) {
    const occupancy = roomOccupancy(inputs);
    if (occupancy === null) return insufficientData(["room_occupancy or occupancy_headcount"]);

    const withinLimit = occupancy <= thresholds.maxResidentsPerRoom;

    return {
      outcome: withinLimit ? "pass" : "fail",
      computedExplanation: renderTemplate(ROOM_HEADCOUNT_TEMPLATE, {
        occupancy,
        maximum: thresholds.maxResidentsPerRoom,
        verdict: withinLimit ? "Within the maximum" : `Over by ${pluralize(occupancy - thresholds.maxResidentsPerRoom, "resident")}`,
      }),
      missingKeys: [],
      observed: { occupancy, maximum: thresholds.maxResidentsPerRoom },
    };
  },
});

// ---------------------------------------------------------------------------
// R18_CD_CERT — civil_defence_expiry_date > assessment date
// ---------------------------------------------------------------------------

const cdCertThresholds = z.object({
  /**
   * How many days of validity must remain *after* the assessment date. 0
   * means the certificate must outlast the assessment date itself, so one
   * expiring on the day of the visit fails.
   */
  minDaysValidAfterAssessment: z.number().int().min(0),
});

const CD_CERT_TEMPLATE =
  "Civil defence certificate expires {expiry}; assessment date {assessmentDate} ({remaining}). Must remain valid at least {minDays} day(s) beyond the assessment date. {verdict}.";

export const R18_CD_CERT = defineRule({
  code: "R18_CD_CERT",
  title: "Civil defence certificate valid at the assessment date",
  module: "employment_practices",
  requirementSlNo: 18,
  inputFactKeys: ["civil_defence_expiry_date"],
  quantitativeKeys: [],
  defaultThresholds: { minDaysValidAfterAssessment: 0 },
  thresholdsSchema: cdCertThresholds,
  legalReference:
    "WWAP checklist requirement 18 (Decent accommodation and food); civil defence certification. PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: CD_CERT_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, { expiry: fact("civil_defence_expiry_date", asIsoDate) });
    if (!got.ok) return insufficientData(got.missing);

    const { expiry } = got.values;
    const daysRemaining = daysBetween(inputs.assessmentDate, expiry);
    // Strictly greater: a certificate expiring on the assessment date does
    // not cover the assessment date.
    const valid = daysRemaining > thresholds.minDaysValidAfterAssessment;

    return {
      outcome: valid ? "pass" : "fail",
      computedExplanation: renderTemplate(CD_CERT_TEMPLATE, {
        expiry,
        assessmentDate: inputs.assessmentDate,
        remaining:
          daysRemaining > 0
            ? `${pluralize(daysRemaining, "day")} remaining`
            : daysRemaining === 0
              ? "expires on the assessment date"
              : `expired ${pluralize(-daysRemaining, "day")} earlier`,
        minDays: thresholds.minDaysValidAfterAssessment,
        verdict: valid ? "Valid" : "Not valid for the assessment date",
      }),
      missingKeys: [],
      observed: { expiry, assessmentDate: inputs.assessmentDate, daysRemaining },
    };
  },
});

// ---------------------------------------------------------------------------
// ACM_TOILET_RATIO — residents per toilet/shower/washbasin
// ---------------------------------------------------------------------------

const toiletRatioThresholds = z.object({
  maxResidentsPerToilet: z.number().min(1),
  maxResidentsPerShower: z.number().min(1),
  maxResidentsPerWashbasin: z.number().min(1),
});

const TOILET_RATIO_TEMPLATE =
  "{residents} residents: toilets {toilets} of {toiletsRequired} required (1 per {perToilet}); showers {showers} of {showersRequired} required (1 per {perShower}); washbasins {washbasins} of {washbasinsRequired} required (1 per {perWashbasin}). {verdict}.";

export const ACM_TOILET_RATIO = defineRule({
  code: "ACM_TOILET_RATIO",
  title: "Sanitary fixtures per resident meet the required ratios",
  module: "accommodation",
  requirementSlNo: 3,
  inputFactKeys: [],
  quantitativeKeys: ["residents", "toilets", "showers", "washbasins"],
  /**
   * PLACEHOLDER RATIOS. 1 fixture per 8 residents is seeded so the rule
   * is executable, but the figures in Cabinet Resolution 13 of 2009 have
   * not been verified against the text — see docs/decisions.md. They are
   * thresholds precisely so an admin can correct them without a code
   * change, and every evaluation is stamped with the ratio it used.
   */
  defaultThresholds: { maxResidentsPerToilet: 8, maxResidentsPerShower: 8, maxResidentsPerWashbasin: 8 },
  thresholdsSchema: toiletRatioThresholds,
  legalReference:
    "Cabinet Resolution 13 of 2009 (general standards for labour accommodation), sanitary facilities. PENDING VERIFICATION: exact ratios to be confirmed against the published text.",
  explanationTemplate: TOILET_RATIO_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      residents: quant("residents", asInteger),
      toilets: quant("toilets", asInteger),
      showers: quant("showers", asInteger),
      washbasins: quant("washbasins", asInteger),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { residents, toilets, showers, washbasins } = got.values;
    if (residents <= 0) {
      return insufficientData([], `Recorded resident count is ${residents}, so fixture ratios cannot be calculated.`);
    }

    const required = {
      toilets: Math.ceil(residents / thresholds.maxResidentsPerToilet),
      showers: Math.ceil(residents / thresholds.maxResidentsPerShower),
      washbasins: Math.ceil(residents / thresholds.maxResidentsPerWashbasin),
    };

    const shortfalls: string[] = [];
    if (toilets < required.toilets) shortfalls.push(`${required.toilets - toilets} toilet(s)`);
    if (showers < required.showers) shortfalls.push(`${required.showers - showers} shower(s)`);
    if (washbasins < required.washbasins) shortfalls.push(`${required.washbasins - washbasins} washbasin(s)`);

    return {
      outcome: shortfalls.length === 0 ? "pass" : "fail",
      computedExplanation: renderTemplate(TOILET_RATIO_TEMPLATE, {
        residents,
        toilets,
        toiletsRequired: required.toilets,
        perToilet: formatNumber(thresholds.maxResidentsPerToilet),
        showers,
        showersRequired: required.showers,
        perShower: formatNumber(thresholds.maxResidentsPerShower),
        washbasins,
        washbasinsRequired: required.washbasins,
        perWashbasin: formatNumber(thresholds.maxResidentsPerWashbasin),
        verdict: shortfalls.length === 0 ? "Meets every ratio" : `Short of ${listPhrase(shortfalls)}`,
      }),
      missingKeys: [],
      observed: { residents, toilets, showers, washbasins, required },
    };
  },
});
