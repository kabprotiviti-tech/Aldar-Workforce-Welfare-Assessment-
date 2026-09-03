import { NO_PREVIOUS_ITEM, type PreviousItemSnapshot } from "@/lib/assessment/carry-forward";
import type { ComplianceRating } from "@/lib/rules/constants";

/**
 * Populating one assessment's requirements/areas when it's created —
 * this prompt: "pre-populate every requirement/area with the previous
 * cycle's status, remarks and open actions, marked was_assessed =
 * false."
 *
 * Deliberately its own module rather than folded into
 * lib/scheduling/generate-cycle.ts: that module's contract (bulk-insert
 * `assessments` rows, return a count, keep the 95-facilities-under-5-
 * seconds path intact) already has its own tests this feature shouldn't
 * put at risk. This one operates per assessment, called once a row
 * exists — from the bulk cycle-generation flow, or standalone for a
 * single follow-up assessment created any other way.
 *
 * Pure planning function + injected port, the same split as
 * lib/rooms/propose.ts: the plan is provable without a database, the
 * adapter (lib/assessment/generate-items-supabase.ts) is the only thing
 * that touches Supabase.
 */

export interface RequirementForGeneration {
  requirementId: string;
  slNo: number;
}

export interface PreviousItemForGeneration {
  itemId: string;
  complianceStatus: ComplianceRating | null;
  remarks: string | null;
  actionRequired: string | null;
}

export interface AssessmentItemPlan {
  requirementId: string;
  wasAssessed: boolean;
  snapshot: PreviousItemSnapshot;
}

/**
 * One plan row per requirement in the template. A requirement with a
 * matching item on the previous assessment is pre-populated and marked
 * not yet assessed this cycle; one with none (a first-ever assessment,
 * or a requirement the previous template didn't have) starts fresh,
 * exactly as it already does without this feature — `was_assessed`
 * defaults to `true` on the table for precisely that reason.
 */
export function planAssessmentItems(
  requirements: readonly RequirementForGeneration[],
  previousItemsByRequirementId: ReadonlyMap<string, PreviousItemForGeneration>,
): AssessmentItemPlan[] {
  return requirements.map((requirement) => {
    const previous = previousItemsByRequirementId.get(requirement.requirementId);
    if (!previous) {
      return { requirementId: requirement.requirementId, wasAssessed: true, snapshot: NO_PREVIOUS_ITEM };
    }

    return {
      requirementId: requirement.requirementId,
      wasAssessed: false,
      snapshot: {
        previousComplianceStatus: previous.complianceStatus,
        previousRemarks: previous.remarks,
        previousActionRequired: previous.actionRequired,
        carriedForwardFromItemId: previous.itemId,
      },
    };
  });
}
