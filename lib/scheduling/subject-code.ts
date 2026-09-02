import type { DbModule } from "@/lib/db/common";
import type { AssessmentType } from "@/lib/db/assessments";
import { MODULES, type Module } from "@/lib/rules/constants";

/**
 * lib/db/common.ts's dbModuleSchema (full words, the database's own
 * vocabulary) and lib/rules/constants.ts's MODULES (EP/ONB/ACM, the report
 * subject-code vocabulary) name the same three modules for different
 * purposes — see docs/decisions.md. This is the one place that maps
 * between them.
 */
export const DB_MODULE_TO_CODE: Record<DbModule, Module> = {
  employment_practices: MODULES[0],
  onboarding: MODULES[1],
  accommodation: MODULES[2],
};

export function assessmentTypeCode(type: AssessmentType): "IN" | "FU" {
  return type === "initial" ? "IN" : "FU";
}

/** 1 -> "1", 3.5 -> "3.5" — never a trailing ".0". */
export function formatAuditNumber(auditNumber: number): string {
  return Number.isInteger(auditNumber) ? String(auditNumber) : auditNumber.toFixed(1);
}

/**
 * Next audit number for a full audit vs. a follow-up, given the entity (or
 * facility)/module's most recent audit number so far (undefined if this is
 * its first ever assessment under this module).
 *
 * Full audits are whole numbers (1, 2, 3, ...); a follow-up between two
 * full audits takes the whole number below it plus .5. This exactly
 * reproduces CONTEXT.md's own example sequence "..., 3, 3.5, 4": a
 * follow-up after full audit 3 is numbered 3.5, and the next full audit
 * after *that* is floor(3.5) + 1 = 4. A second follow-up requested before
 * the next full audit would collide with the first (both floor(3.5) - not
 * defined by the brief) and is rejected by assessments.subject_code's own
 * unique constraint rather than silently mis-numbered. See docs/decisions.md.
 */
export function nextAuditNumber(lastAuditNumber: number | undefined, type: AssessmentType): number {
  const lastWhole = lastAuditNumber === undefined ? 0 : Math.floor(lastAuditNumber);
  return type === "follow_up" ? lastWhole + 0.5 : lastWhole + 1;
}

export interface SubjectCodeInput {
  year: number;
  module: DbModule;
  assessmentType: AssessmentType;
  /** entity_code for Employment Practices/Onboarding; facility_code for Accommodation. See docs/decisions.md. */
  entityOrFacilityCode: string;
  auditNumber: number;
}

/**
 * YEAR-MODULE-TYPE-ENTITYCODE[-AUDITNUMBER] (CONTEXT.md). The audit-number
 * suffix is omitted only when auditNumber is exactly 1 — an entity's or
 * facility's very first assessment under this module — which is the only
 * reading that reconciles CONTEXT.md's own two examples: the suffixed
 * "2023-EP-FU-GLIS-3.5" alongside the unsuffixed "2022-ACM-FU-DIC". See
 * docs/decisions.md.
 */
export function buildSubjectCode(input: SubjectCodeInput): string {
  const base = `${input.year}-${DB_MODULE_TO_CODE[input.module]}-${assessmentTypeCode(input.assessmentType)}-${input.entityOrFacilityCode}`;
  return input.auditNumber === 1 ? base : `${base}-${formatAuditNumber(input.auditNumber)}`;
}
