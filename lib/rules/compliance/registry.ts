import type { DbModule } from "@/lib/db/common";
import type { CompiledRule } from "@/lib/rules/compliance/types";
import { R11_WAGE_DATE, R11_WPS_COVERAGE, R12_DEDUCTIONS, R13_OT_RATE } from "@/lib/rules/compliance/rules/wages";
import { R10_DOC_RETURN, R14_INSURANCE, R16_HOURS } from "@/lib/rules/compliance/rules/employment";
import {
  ACM_OCCUPANCY_RECONCILED,
  ACM_TOILET_RATIO,
  R18_CD_CERT,
  R18_ROOM_AREA,
  R18_ROOM_HEADCOUNT,
} from "@/lib/rules/compliance/rules/accommodation";
import { R08_AGENCY_CLAUSE, R19_VEHICLE_REG } from "@/lib/rules/compliance/rules/assets";

/**
 * Every rule in v1 (this prompt's list). Codes prefixed R** evaluate an
 * Employment Practices checklist requirement — the number in the code is
 * that requirement's sl_no — and ACM_** evaluates an Accommodation area.
 * See docs/decisions.md.
 */
export const COMPLIANCE_RULES: readonly CompiledRule[] = [
  R08_AGENCY_CLAUSE,
  R10_DOC_RETURN,
  R11_WAGE_DATE,
  R11_WPS_COVERAGE,
  R12_DEDUCTIONS,
  R13_OT_RATE,
  R14_INSURANCE,
  R16_HOURS,
  R18_CD_CERT,
  R18_ROOM_AREA,
  R18_ROOM_HEADCOUNT,
  R19_VEHICLE_REG,
  ACM_TOILET_RATIO,
  ACM_OCCUPANCY_RECONCILED,
];

const BY_CODE = new Map(COMPLIANCE_RULES.map((rule) => [rule.code, rule]));

export function getRule(code: string): CompiledRule | null {
  return BY_CODE.get(code) ?? null;
}

export function rulesForModule(module: DbModule): CompiledRule[] {
  return COMPLIANCE_RULES.filter((rule) => rule.module === module);
}

/** Every fact key any rule reads — what an evaluation run needs to load from fact_ledger_confirmed. */
export function allInputFactKeys(): string[] {
  return [...new Set(COMPLIANCE_RULES.flatMap((rule) => rule.inputFactKeys))].sort();
}
