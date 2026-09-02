import { z } from "zod";
import {
  asIsoDate,
  asNumber,
  asStringList,
  daysBetween,
  fact,
  insufficientData,
  labelMatches,
  quant,
  requireAll,
} from "@/lib/rules/compliance/inputs";
import { formatNumber, listPhrase, pluralize, renderTemplate } from "@/lib/rules/compliance/format";
import { defineRule } from "@/lib/rules/compliance/types";

/** Document return (R10), medical insurance (R14) and working hours (R16). */

// ---------------------------------------------------------------------------
// R10_DOC_RETURN — return time <= 24h normal, <= 6h emergency
// ---------------------------------------------------------------------------

const docReturnThresholds = z.object({
  maxHoursNormal: z.number().min(0),
  maxHoursEmergency: z.number().min(0),
});

export const documentReturnContexts = ["normal", "emergency"] as const;

const DOC_RETURN_TEMPLATE =
  "Passport returned {hours} hours after a {context} request. Limit for a {context} request is {limit} hours. {verdict}.";

export const R10_DOC_RETURN = defineRule({
  code: "R10_DOC_RETURN",
  title: "Personal documents returned within the time limit",
  module: "employment_practices",
  requirementSlNo: 10,
  inputFactKeys: ["passport_return_hours"],
  quantitativeKeys: ["passport_return_context"],
  defaultThresholds: { maxHoursNormal: 24, maxHoursEmergency: 6 },
  thresholdsSchema: docReturnThresholds,
  legalReference:
    "WWAP checklist requirement 10 (No retention of personal documents). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: DOC_RETURN_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      hours: fact("passport_return_hours", asNumber),
      context: quant("passport_return_context", (raw) => {
        const value = typeof raw === "string" ? raw.trim().toLowerCase() : null;
        return value && (documentReturnContexts as readonly string[]).includes(value) ? value : null;
      }),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { hours, context } = got.values;
    const limit = context === "emergency" ? thresholds.maxHoursEmergency : thresholds.maxHoursNormal;
    const withinLimit = hours <= limit;

    return {
      outcome: withinLimit ? "pass" : "fail",
      computedExplanation: renderTemplate(DOC_RETURN_TEMPLATE, {
        hours: formatNumber(hours),
        context,
        limit: formatNumber(limit),
        verdict: withinLimit ? "Within the limit" : `Over by ${formatNumber(hours - limit)} hours`,
      }),
      missingKeys: [],
      observed: { hours, context, limit },
    };
  },
});

// ---------------------------------------------------------------------------
// R14_INSURANCE — policy start <= employment start; all emirates covered
// ---------------------------------------------------------------------------

const insuranceThresholds = z.object({
  /** Every emirate the policy must cover. */
  requiredEmirates: z.array(z.string().min(1)).min(1),
  /** How many days after employment starts a policy may begin. 0 means it must be in force on day one. */
  maxDaysAfterEmploymentStart: z.number().int().min(0),
});

const INSURANCE_TEMPLATE =
  "Policy starts {policyStart}; employment started {employmentStart} ({gap}). Emirates covered: {coveredCount} of {requiredCount}{missingEmirates}. {verdict}.";

export const R14_INSURANCE = defineRule({
  code: "R14_INSURANCE",
  title: "Medical insurance in force from day one, covering every emirate",
  module: "employment_practices",
  requirementSlNo: 14,
  inputFactKeys: ["insurance_policy_start_date", "insurance_emirates_covered"],
  quantitativeKeys: ["employment_start_date"],
  defaultThresholds: {
    requiredEmirates: ["abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"],
    maxDaysAfterEmploymentStart: 0,
  },
  thresholdsSchema: insuranceThresholds,
  legalReference:
    "WWAP checklist requirement 14 (Employer provided medical insurance). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: INSURANCE_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      policyStart: fact("insurance_policy_start_date", asIsoDate),
      emiratesCovered: fact("insurance_emirates_covered", asStringList),
      employmentStart: quant("employment_start_date", asIsoDate),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { policyStart, emiratesCovered, employmentStart } = got.values;

    // Positive when the policy starts after employment did — the gap the
    // worker would have been uninsured for.
    const daysAfterStart = daysBetween(employmentStart, policyStart);
    const startsInTime = daysAfterStart <= thresholds.maxDaysAfterEmploymentStart;

    const missingEmirates = thresholds.requiredEmirates.filter(
      (required) => !emiratesCovered.some((covered) => labelMatches(covered, required)),
    );

    const failures: string[] = [];
    if (!startsInTime) failures.push(`cover began ${pluralize(daysAfterStart, "day")} late`);
    if (missingEmirates.length > 0) failures.push(`${pluralize(missingEmirates.length, "emirate")} not covered`);

    return {
      outcome: failures.length === 0 ? "pass" : "fail",
      computedExplanation: renderTemplate(INSURANCE_TEMPLATE, {
        policyStart,
        employmentStart,
        gap:
          daysAfterStart <= 0
            ? `in force from day one${daysAfterStart < 0 ? `, ${pluralize(-daysAfterStart, "day")} early` : ""}`
            : `${pluralize(daysAfterStart, "day")} uninsured`,
        coveredCount: thresholds.requiredEmirates.length - missingEmirates.length,
        requiredCount: thresholds.requiredEmirates.length,
        missingEmirates: missingEmirates.length > 0 ? ` (missing: ${listPhrase(missingEmirates)})` : "",
        verdict: failures.length === 0 ? "Compliant" : `Not compliant — ${listPhrase(failures)}`,
      }),
      missingKeys: [],
      observed: { policyStart, employmentStart, daysAfterStart, emiratesCovered, missingEmirates },
    };
  },
});

// ---------------------------------------------------------------------------
// R16_HOURS — <= 8/day, <= 48/week, <= 144 per 3 weeks, 1 day off in 7
// ---------------------------------------------------------------------------

const hoursThresholds = z.object({
  maxHoursPerDay: z.number().min(0),
  maxHoursPerWeek: z.number().min(0),
  maxHoursPerThreeWeeks: z.number().min(0),
  /** "One day off in seven" expressed as the longest run of worked days allowed. */
  maxConsecutiveDaysWorked: z.number().int().min(1),
});

const HOURS_TEMPLATE =
  "Per day {hoursPerDay} of {maxPerDay}; per week {hoursPerWeek} of {maxPerWeek}; per 3 weeks {hoursPerThreeWeeks} of {maxPerThreeWeeks}; longest run without a day off {consecutiveDays} of {maxConsecutive} days. {verdict}.";

export const R16_HOURS = defineRule({
  code: "R16_HOURS",
  title: "Working hours and rest days within legal limits",
  module: "employment_practices",
  requirementSlNo: 16,
  inputFactKeys: [],
  quantitativeKeys: ["hours_per_day", "hours_per_week", "hours_per_three_weeks", "max_consecutive_days_worked"],
  defaultThresholds: { maxHoursPerDay: 8, maxHoursPerWeek: 48, maxHoursPerThreeWeeks: 144, maxConsecutiveDaysWorked: 6 },
  thresholdsSchema: hoursThresholds,
  legalReference:
    "WWAP checklist requirement 16 (Legal working hours). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: HOURS_TEMPLATE,
  evaluate(inputs, thresholds) {
    const got = requireAll(inputs, {
      hoursPerDay: quant("hours_per_day", asNumber),
      hoursPerWeek: quant("hours_per_week", asNumber),
      hoursPerThreeWeeks: quant("hours_per_three_weeks", asNumber),
      consecutiveDays: quant("max_consecutive_days_worked", asNumber),
    });
    if (!got.ok) return insufficientData(got.missing);

    const { hoursPerDay, hoursPerWeek, hoursPerThreeWeeks, consecutiveDays } = got.values;

    // Every limit is checked and every breach is named — an assessor
    // should not have to re-run the rule to discover the second problem.
    const breaches: string[] = [];
    if (hoursPerDay > thresholds.maxHoursPerDay) breaches.push("hours per day");
    if (hoursPerWeek > thresholds.maxHoursPerWeek) breaches.push("hours per week");
    if (hoursPerThreeWeeks > thresholds.maxHoursPerThreeWeeks) breaches.push("hours per 3 weeks");
    if (consecutiveDays > thresholds.maxConsecutiveDaysWorked) breaches.push("days worked without a rest day");

    return {
      outcome: breaches.length === 0 ? "pass" : "fail",
      computedExplanation: renderTemplate(HOURS_TEMPLATE, {
        hoursPerDay: formatNumber(hoursPerDay),
        maxPerDay: formatNumber(thresholds.maxHoursPerDay),
        hoursPerWeek: formatNumber(hoursPerWeek),
        maxPerWeek: formatNumber(thresholds.maxHoursPerWeek),
        hoursPerThreeWeeks: formatNumber(hoursPerThreeWeeks),
        maxPerThreeWeeks: formatNumber(thresholds.maxHoursPerThreeWeeks),
        consecutiveDays: formatNumber(consecutiveDays),
        maxConsecutive: thresholds.maxConsecutiveDaysWorked,
        verdict: breaches.length === 0 ? "Within every limit" : `Exceeds ${listPhrase(breaches)}`,
      }),
      missingKeys: [],
      observed: { hoursPerDay, hoursPerWeek, hoursPerThreeWeeks, consecutiveDays, breaches },
    };
  },
});
