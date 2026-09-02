/**
 * Coverage (this prompt: "show coverage — which requirements have no
 * evidence at all"). Pure — given an assessment's requirements and the
 * set of requirement ids any evidence file is linked to
 * (evidence_file_requirements), which requirements have zero linked
 * evidence. Scoped to one assessment's own template, since "coverage"
 * only makes sense against the checklist that assessment is actually
 * being measured against.
 */

export interface CoverageRequirement {
  requirementId: string;
  slNo: number;
  title: string;
}

export interface CoverageRow extends CoverageRequirement {
  hasEvidence: boolean;
}

export function computeCoverage(
  requirements: readonly CoverageRequirement[],
  linkedRequirementIds: ReadonlySet<string>,
): CoverageRow[] {
  return [...requirements]
    .sort((a, b) => a.slNo - b.slNo)
    .map((requirement) => ({ ...requirement, hasEvidence: linkedRequirementIds.has(requirement.requirementId) }));
}

export function requirementsWithNoEvidence(coverage: readonly CoverageRow[]): CoverageRow[] {
  return coverage.filter((row) => !row.hasEvidence);
}
