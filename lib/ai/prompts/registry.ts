import type { z } from "zod";
import type { DocumentClass } from "@/lib/db/evidence";
import * as wpsReport from "@/lib/ai/prompts/wps_report/v1";
import * as payrollRegister from "@/lib/ai/prompts/payroll_register/v1";
import * as employmentContract from "@/lib/ai/prompts/employment_contract/v1";
import * as recruitmentAgreement from "@/lib/ai/prompts/recruitment_agreement/v1";
import * as passportRegister from "@/lib/ai/prompts/passport_register/v1";
import * as insuranceSchedule from "@/lib/ai/prompts/insurance_schedule/v1";
import * as accommodationContract from "@/lib/ai/prompts/accommodation_contract/v1";
import * as civilDefenceCertificate from "@/lib/ai/prompts/civil_defence_certificate/v1";
import * as occupancySchedule from "@/lib/ai/prompts/occupancy_schedule/v2";
import * as approvedDrawing from "@/lib/ai/prompts/approved_drawing/v2";
import * as vehicleRegistration from "@/lib/ai/prompts/vehicle_registration/v1";
import * as inductionRegister from "@/lib/ai/prompts/induction_register/v1";

export interface PromptDefinition {
  version: string;
  factKeys: readonly string[];
  systemPrompt: string;
  responseSchema: z.ZodTypeAny;
}

function definitionOf(module: {
  promptVersion: string;
  factKeys: readonly string[];
  systemPrompt: string;
  responseSchema: z.ZodTypeAny;
}): PromptDefinition {
  return {
    version: module.promptVersion,
    factKeys: module.factKeys,
    systemPrompt: module.systemPrompt,
    responseSchema: module.responseSchema,
  };
}

/**
 * One entry per document_class with a v1 extraction prompt (this prompt:
 * "One extraction prompt per document_class"). "worker_register" and
 * "photo" — two of the fourteen document classes from the evidence
 * handling phase — are deliberately absent: this prompt's own v1 fact-key
 * list gives neither of them anything to extract ("extend later"), and
 * inventing plausible-sounding fact keys they weren't given isn't this
 * repo's call to make. lib/ai/extract.ts skips these with a clear reason
 * instead of calling the API for no defined purpose. See docs/decisions.md.
 */
export const PROMPT_REGISTRY: Partial<Record<DocumentClass, PromptDefinition>> = {
  wps_report: definitionOf(wpsReport),
  payroll_register: definitionOf(payrollRegister),
  employment_contract: definitionOf(employmentContract),
  recruitment_agreement: definitionOf(recruitmentAgreement),
  passport_register: definitionOf(passportRegister),
  insurance_schedule: definitionOf(insuranceSchedule),
  accommodation_contract: definitionOf(accommodationContract),
  civil_defence_certificate: definitionOf(civilDefenceCertificate),
  occupancy_schedule: definitionOf(occupancySchedule),
  approved_drawing: definitionOf(approvedDrawing),
  vehicle_registration: definitionOf(vehicleRegistration),
  induction_register: definitionOf(inductionRegister),
};

export function getPromptDefinition(documentClass: string | null): PromptDefinition | null {
  if (!documentClass) return null;
  return PROMPT_REGISTRY[documentClass as DocumentClass] ?? null;
}
