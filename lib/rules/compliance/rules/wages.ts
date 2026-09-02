import { z } from "zod";
import {
  asInteger,
  asIsoDate,
  asIsoMonth,
  asStringList,
  daysBetween,
  daysInMonth,
  fact,
  insufficientData,
  labelMatches,
  quant,
  requireAll,
} from "@/lib/rules/compliance/inputs";
import { formatFixed, formatNumber, listPhrase, pluralize, renderTemplate } from "@/lib/rules/compliance/format";
import { defineRule } from "@/lib/rules/compliance/types";

/** Timely wage payment (R11) and full wages (R12). */

// ---------------------------------------------------------------------------
// R11_WAGE_DATE — transfer_date <= 15th of the following month
// ---------------------------------------------------------------------------

const wageDateThresholds = z.object({
  /** Wages for a period must be transferred by this day of the following month. */
  deadlineDayOfFollowingMonth: z.number().int().min(1).max(31),
});

/**
 * The deadline day, clamped to the length of the deadline month — a
 * threshold of 31 must still mean "the last day" in a 30-day month rather
 * than silently rolling into the next one.
 */
function deadlineFor(wagePeriodMonth: string, deadlineDay: number): string {
  const year = Number(wagePeriodMonth.slice(0, 4));
  const month = Number(wagePeriodMonth.slice(5, 7));
  const deadlineYear = month === 12 ? year + 1 : year;
  const deadlineMonth = month === 12 ? 1 : month + 1;
  const day = Math.min(deadlineDay, daysInMonth(deadlineYear, deadlineMonth));
  return `${deadlineYear}-${String(deadlineMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const WAGE_DATE_TEMPLATE =
  "Wages for {period} were transferred on {transferDate}. Deadline is day {deadlineDay} of the following month ({deadline}). {verdict}.";

export const R11_WAGE_DATE = defineRule({
  code: "R11_WAGE_DATE",
  title: "Wages transferred by the statutory deadline",
  module: "employment_practices",
  requirementSlNo: 11,
  inputFactKeys: ["wps_transfer_date"],
  quantitativeKeys: ["wage_period_month"],
  defaultThresholds: { deadlineDayOfFollowingMonth: 15 },
  thresholdsSchema: wageDateThresholds,
  legalReference:
    "WWAP checklist requirement 11 (Timely wage payment), UAE Wage Protection System. PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: WAGE_DATE_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      transferDate: fact("wps_transfer_date", asIsoDate),
      wagePeriod: quant("wage_period_month", asIsoMonth),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { transferDate, wagePeriod } = got.values;
    const deadline = deadlineFor(wagePeriod, thresholds.deadlineDayOfFollowingMonth);
    const daysLate = daysBetween(deadline, transferDate);
    // On the deadline day itself is on time — the rule is "<= the 15th".
    const onTime = daysLate <= 0;

    return {
      outcome: onTime ? "pass" : "fail",
      computedExplanation: renderTemplate(WAGE_DATE_TEMPLATE, {
        period: wagePeriod,
        transferDate,
        deadlineDay: thresholds.deadlineDayOfFollowingMonth,
        deadline,
        verdict: onTime ? "On or before the deadline" : `Late by ${pluralize(daysLate, "day")}`,
      }),
      missingKeys: [],
      observed: { transferDate, wagePeriod, deadline, daysLate },
    };
  },
});

// ---------------------------------------------------------------------------
// R11_WPS_COVERAGE — record_count vs worker_register_count, all divisions present
// ---------------------------------------------------------------------------

const wpsCoverageThresholds = z.object({
  /** WPS records as a proportion of the worker register. 1 means every worker must appear. */
  minCoverageRatio: z.number().min(0).max(1),
  /** Whether every division named in the expected list must appear in the file. */
  requireAllDivisions: z.boolean(),
});

const WPS_COVERAGE_TEMPLATE =
  "WPS file lists {recordCount} records against a worker register of {workerCount} ({coverage} coverage, minimum {minCoverage}). Divisions: {divisionsPresent} of {divisionsExpected} present{missingDivisions}. {verdict}.";

export const R11_WPS_COVERAGE = defineRule({
  code: "R11_WPS_COVERAGE",
  title: "WPS file covers every worker and every division",
  module: "employment_practices",
  requirementSlNo: 11,
  inputFactKeys: ["wps_record_count"],
  quantitativeKeys: ["worker_register_count", "wps_divisions_present", "expected_divisions"],
  defaultThresholds: { minCoverageRatio: 1, requireAllDivisions: true },
  legalReference:
    "WWAP checklist requirement 11 (Timely wage payment), UAE Wage Protection System. PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  thresholdsSchema: wpsCoverageThresholds,
  explanationTemplate: WPS_COVERAGE_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      recordCount: fact("wps_record_count", asInteger),
      workerCount: quant("worker_register_count", asInteger),
      expectedDivisions: quant("expected_divisions", asStringList),
      presentDivisions: quant("wps_divisions_present", asStringList),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { recordCount, workerCount, expectedDivisions, presentDivisions } = got.values;
    if (workerCount <= 0) {
      return insufficientData([], "The worker register count is zero, so WPS coverage cannot be expressed as a proportion.");
    }

    const coverageRatio = recordCount / workerCount;
    const coverageMet = coverageRatio >= thresholds.minCoverageRatio;

    const missingDivisions = expectedDivisions.filter(
      (expected) => !presentDivisions.some((present) => labelMatches(present, expected)),
    );
    const divisionsMet = !thresholds.requireAllDivisions || missingDivisions.length === 0;

    const failures: string[] = [];
    if (!coverageMet) failures.push(`${workerCount - recordCount} worker(s) not covered`);
    if (!divisionsMet) failures.push(`${pluralize(missingDivisions.length, "division")} absent`);

    return {
      outcome: coverageMet && divisionsMet ? "pass" : "fail",
      computedExplanation: renderTemplate(WPS_COVERAGE_TEMPLATE, {
        recordCount,
        workerCount,
        coverage: `${formatNumber(coverageRatio * 100)}%`,
        minCoverage: `${formatNumber(thresholds.minCoverageRatio * 100)}%`,
        divisionsPresent: expectedDivisions.length - missingDivisions.length,
        divisionsExpected: expectedDivisions.length,
        missingDivisions: missingDivisions.length > 0 ? ` (missing: ${listPhrase(missingDivisions)})` : "",
        verdict: failures.length === 0 ? "Fully covered" : `Not covered — ${listPhrase(failures)}`,
      }),
      missingKeys: [],
      observed: { recordCount, workerCount, coverageRatio, expectedDivisions, presentDivisions, missingDivisions },
    };
  },
});

// ---------------------------------------------------------------------------
// R12_DEDUCTIONS — deduction types not in {ppe, transport, work_permit, emirates_id}
// ---------------------------------------------------------------------------

const deductionThresholds = z.object({
  /** Deduction types a worker may never be charged for. */
  prohibitedTypes: z.array(z.string().min(1)).min(1),
});

const DEDUCTIONS_TEMPLATE =
  "Deductions recorded: {observed}. Prohibited types: {prohibited}. Found: {found}. {verdict}.";

export const R12_DEDUCTIONS = defineRule({
  code: "R12_DEDUCTIONS",
  title: "No prohibited payroll deductions",
  module: "employment_practices",
  requirementSlNo: 12,
  inputFactKeys: ["payroll_deduction_types"],
  quantitativeKeys: [],
  defaultThresholds: { prohibitedTypes: ["ppe", "transport", "work_permit", "emirates_id"] },
  thresholdsSchema: deductionThresholds,
  legalReference:
    "WWAP checklist requirement 12 (Full wages and benefits). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: DEDUCTIONS_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      deductionTypes: fact("payroll_deduction_types", asStringList),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { deductionTypes } = got.values;
    // A recorded deduction is prohibited if its label names a prohibited
    // type as a whole word — "PPE charges" is a PPE deduction.
    const offending = deductionTypes.filter((type) => thresholds.prohibitedTypes.some((prohibited) => labelMatches(type, prohibited)));

    return {
      outcome: offending.length === 0 ? "pass" : "fail",
      computedExplanation: renderTemplate(DEDUCTIONS_TEMPLATE, {
        observed: listPhrase(deductionTypes),
        prohibited: listPhrase(thresholds.prohibitedTypes),
        found: listPhrase(offending),
        verdict: offending.length === 0 ? "No prohibited deductions" : `${pluralize(offending.length, "prohibited deduction")} applied`,
      }),
      missingKeys: [],
      observed: { deductionTypes, offending },
    };
  },
});

// ---------------------------------------------------------------------------
// R13_OT_RATE — 50% on rest day/public holiday/2200-0400, 25% otherwise
// ---------------------------------------------------------------------------

const otRateThresholds = z.object({
  /** Minimum premium over normal pay for ordinary overtime, as a percentage. */
  premiumPctStandard: z.number().min(0),
  /** Minimum premium for rest days, public holidays and the night window. */
  premiumPctEnhanced: z.number().min(0),
  enhancedCategories: z.array(z.string().min(1)).min(1),
  /** The night window the enhanced premium applies to, stated for the explanation. */
  nightWindow: z.object({ from: z.string(), to: z.string() }),
});

export const overtimeCategories = ["standard", "rest_day", "public_holiday", "night"] as const;

/**
 * Reads the applied premium as a percentage from what the model or an
 * assessor actually wrote. "1.25x", "125%" and 1.25 all mean a 25%
 * premium; a bare percentage below 100 ("25%") is read as the premium
 * itself, since a multiplier below 1 would be a pay cut rather than
 * overtime. Anything else returns null, which surfaces as
 * insufficient_data naming the key rather than a guess.
 */
export function parseOvertimePremiumPct(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? multiplierToPremium(raw) : null;
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  const percentMatch = /^(\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
  if (percentMatch) {
    const value = Number(percentMatch[1]);
    return value < 100 ? value : value - 100;
  }

  const multiplierMatch = /^(\d+(?:\.\d+)?)\s*x?$/.exec(trimmed);
  if (multiplierMatch) return multiplierToPremium(Number(multiplierMatch[1]));

  return null;
}

function multiplierToPremium(multiplier: number): number | null {
  if (multiplier < 1) return null;
  return Math.round((multiplier - 1) * 100 * 100) / 100;
}

const OT_RATE_TEMPLATE =
  "Overtime worked on {category}: {appliedPct}% premium applied against a minimum of {requiredPct}% ({basis}). {verdict}.";

export const R13_OT_RATE = defineRule({
  code: "R13_OT_RATE",
  title: "Correct overtime premium applied",
  module: "employment_practices",
  requirementSlNo: 13,
  inputFactKeys: ["overtime_rate_applied"],
  quantitativeKeys: ["overtime_category"],
  defaultThresholds: {
    premiumPctStandard: 25,
    premiumPctEnhanced: 50,
    enhancedCategories: ["rest_day", "public_holiday", "night"],
    nightWindow: { from: "22:00", to: "04:00" },
  },
  thresholdsSchema: otRateThresholds,
  legalReference:
    "WWAP checklist requirement 13 (Correct overtime remuneration). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: OT_RATE_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      appliedPct: fact("overtime_rate_applied", parseOvertimePremiumPct),
      category: quant("overtime_category", (raw) => {
        const value = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[\s-]+/g, "_") : null;
        return value && (overtimeCategories as readonly string[]).includes(value) ? value : null;
      }),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { appliedPct, category } = got.values;
    const enhanced = thresholds.enhancedCategories.some((entry) => labelMatches(entry, category));
    const requiredPct = enhanced ? thresholds.premiumPctEnhanced : thresholds.premiumPctStandard;
    const met = appliedPct >= requiredPct;

    return {
      outcome: met ? "pass" : "fail",
      computedExplanation: renderTemplate(OT_RATE_TEMPLATE, {
        category: category.replace(/_/g, " "),
        appliedPct: formatNumber(appliedPct),
        requiredPct: formatNumber(requiredPct),
        basis: enhanced
          ? `rest day, public holiday or ${thresholds.nightWindow.from}-${thresholds.nightWindow.to}`
          : "ordinary overtime hours",
        verdict: met ? "Meets the minimum premium" : `Short by ${formatFixed(requiredPct - appliedPct, 2)} percentage points`,
      }),
      missingKeys: [],
      observed: { appliedPct, category, requiredPct, enhanced },
    };
  },
});
