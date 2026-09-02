import { z } from "zod";
import { asBoolean, asIsoDate, asString, daysBetween, fact, insufficientData, optional, quant } from "@/lib/rules/compliance/inputs";
import { listPhrase, pluralize, renderTemplate } from "@/lib/rules/compliance/format";
import { defineRule, type RuleInputs } from "@/lib/rules/compliance/types";

/**
 * Vehicle registration (R19) and the recruitment-agency employer-pays
 * clause (R08). Both are "every one of them" rules, so both accept a list
 * of subjects from the assessor alongside the single document the model
 * read — an extraction covers one file, but the requirement covers the
 * whole fleet or every agency agreement.
 */

const vehicleEntrySchema = z.object({
  reference: z.string().min(1),
  expiry_date: z.string().min(1),
});

const agencyEntrySchema = z.object({
  agency_name: z.string().min(1),
  clause_present: z.boolean(),
});

// ---------------------------------------------------------------------------
// R19_VEHICLE_REG — registration expiry > assessment date, all vehicles
// ---------------------------------------------------------------------------

const vehicleThresholds = z.object({
  minDaysValidAfterAssessment: z.number().int().min(0),
});

const VEHICLE_TEMPLATE =
  "{checked} checked against the assessment date {assessmentDate}: {expiredCount} expired or expiring{expiredDetail}. Registration must remain valid at least {minDays} day(s) beyond the assessment date. {verdict}.";

interface VehicleSubject {
  reference: string;
  expiryDate: string;
}

/** The fleet as the rule sees it: the assessor's list, plus the one registration document the model read. */
function vehicleSubjects(inputs: RuleInputs): { subjects: VehicleSubject[]; malformed: number } {
  const subjects: VehicleSubject[] = [];
  let malformed = 0;

  const raw = inputs.quantitative["vehicle_registrations"];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const parsed = vehicleEntrySchema.safeParse(entry);
      const expiry = parsed.success ? asIsoDate(parsed.data.expiry_date) : null;
      if (parsed.success && expiry) {
        subjects.push({ reference: parsed.data.reference, expiryDate: expiry });
      } else {
        malformed += 1;
      }
    }
  }

  const documentExpiry = optional(inputs, fact("vehicle_registration_expiry_date", asIsoDate));
  if (documentExpiry && !subjects.some((subject) => subject.expiryDate === documentExpiry)) {
    subjects.push({ reference: "registration document", expiryDate: documentExpiry });
  }

  return { subjects, malformed };
}

export const R19_VEHICLE_REG = defineRule({
  code: "R19_VEHICLE_REG",
  title: "Every vehicle registration valid at the assessment date",
  module: "employment_practices",
  requirementSlNo: 19,
  inputFactKeys: ["vehicle_registration_expiry_date"],
  quantitativeKeys: ["vehicle_registrations"],
  defaultThresholds: { minDaysValidAfterAssessment: 0 },
  thresholdsSchema: vehicleThresholds,
  legalReference:
    "WWAP checklist requirement 19 (Safe transportation). PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: VEHICLE_TEMPLATE,
  evaluate(inputs, thresholds) {
    const { subjects, malformed } = vehicleSubjects(inputs);
    if (subjects.length === 0) {
      return insufficientData(
        ["vehicle_registrations or vehicle_registration_expiry_date"],
        malformed > 0 ? `${pluralize(malformed, "entry", "entries")} could not be read as a reference and expiry date.` : undefined,
      );
    }

    const expired = subjects.filter(
      (subject) => daysBetween(inputs.assessmentDate, subject.expiryDate) <= thresholds.minDaysValidAfterAssessment,
    );

    // A list the rule could only partly read is not a clean pass: the
    // unreadable entries might be the expired ones.
    if (expired.length === 0 && malformed > 0) {
      return insufficientData(
        [],
        `${subjects.length} registration(s) are valid, but ${pluralize(malformed, "entry", "entries")} could not be read, so the fleet cannot be cleared.`,
      );
    }

    return {
      outcome: expired.length === 0 ? "pass" : "fail",
      computedExplanation: renderTemplate(VEHICLE_TEMPLATE, {
        checked: pluralize(subjects.length, "vehicle registration"),
        assessmentDate: inputs.assessmentDate,
        expiredCount: expired.length,
        expiredDetail: expired.length > 0 ? ` (${listPhrase(expired.map((subject) => `${subject.reference} on ${subject.expiryDate}`))})` : "",
        minDays: thresholds.minDaysValidAfterAssessment,
        verdict: expired.length === 0 ? "All valid" : `${pluralize(expired.length, "registration")} not valid for the assessment date`,
      }),
      missingKeys: [],
      observed: { subjects, expired, malformed, assessmentDate: inputs.assessmentDate },
    };
  },
});

// ---------------------------------------------------------------------------
// R08_AGENCY_CLAUSE — employer_pays_clause present on every agency agreement
// ---------------------------------------------------------------------------

const agencyThresholds = z.object({
  /** Whether the clause is required on every agreement, or only on one. */
  requireOnEveryAgreement: z.boolean(),
});

const AGENCY_TEMPLATE =
  "{checked} checked: employer-pays clause present on {presentCount}, absent on {absentCount}{absentDetail}. {requirementPhrase}. {verdict}.";

interface AgencySubject {
  agencyName: string;
  clausePresent: boolean;
}

function agencySubjects(inputs: RuleInputs): { subjects: AgencySubject[]; malformed: number } {
  const subjects: AgencySubject[] = [];
  let malformed = 0;

  const raw = inputs.quantitative["agency_agreements"];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const parsed = agencyEntrySchema.safeParse(entry);
      if (parsed.success) {
        subjects.push({ agencyName: parsed.data.agency_name, clausePresent: parsed.data.clause_present });
      } else {
        malformed += 1;
      }
    }
  }

  // The one agreement the model read. `false` is a real finding (the
  // clause is absent) and must reach the rule as a value, not a gap.
  const documentClause = optional(inputs, fact("agency_employer_pays_clause_present", asBoolean));
  if (documentClause !== null) {
    const name = optional(inputs, fact("agency_name", asString)) ?? "agreement on file";
    if (!subjects.some((subject) => subject.agencyName === name)) {
      subjects.push({ agencyName: name, clausePresent: documentClause });
    }
  }

  return { subjects, malformed };
}

export const R08_AGENCY_CLAUSE = defineRule({
  code: "R08_AGENCY_CLAUSE",
  title: "Employer-pays clause on every recruitment agency agreement",
  module: "employment_practices",
  requirementSlNo: 8,
  inputFactKeys: ["agency_employer_pays_clause_present", "agency_name"],
  quantitativeKeys: ["agency_agreements"],
  defaultThresholds: { requireOnEveryAgreement: true },
  thresholdsSchema: agencyThresholds,
  legalReference:
    "WWAP checklist requirement 8 (No fees recruitment); employer-pays principle. PENDING VERIFICATION: statutory citation to be confirmed by the client.",
  explanationTemplate: AGENCY_TEMPLATE,
  evaluate(inputs, thresholds) {
    const { subjects, malformed } = agencySubjects(inputs);
    if (subjects.length === 0) {
      return insufficientData(
        ["agency_agreements or agency_employer_pays_clause_present"],
        malformed > 0 ? `${pluralize(malformed, "entry", "entries")} could not be read as an agency name and clause flag.` : undefined,
      );
    }

    const absent = subjects.filter((subject) => !subject.clausePresent);
    const presentCount = subjects.length - absent.length;
    const met = thresholds.requireOnEveryAgreement ? absent.length === 0 : presentCount > 0;

    if (met && malformed > 0) {
      return insufficientData(
        [],
        `${presentCount} agreement(s) carry the clause, but ${pluralize(malformed, "entry", "entries")} could not be read, so the set cannot be cleared.`,
      );
    }

    return {
      outcome: met ? "pass" : "fail",
      computedExplanation: renderTemplate(AGENCY_TEMPLATE, {
        checked: pluralize(subjects.length, "agency agreement"),
        presentCount,
        absentCount: absent.length,
        absentDetail: absent.length > 0 ? ` (${listPhrase(absent.map((subject) => subject.agencyName))})` : "",
        requirementPhrase: thresholds.requireOnEveryAgreement
          ? "The clause is required on every agreement"
          : "At least one agreement must carry the clause",
        verdict: met ? "Requirement met" : "Requirement not met",
      }),
      missingKeys: [],
      observed: { subjects, absent, malformed, requireOnEveryAgreement: thresholds.requireOnEveryAgreement },
    };
  },
});
