import { isKeyRequirement } from "@/lib/rules/constants";
import type { ComplianceRating } from "@/lib/rules/constants";
import type { FindingPriority } from "@/lib/db/findings";

/**
 * Finding priority (this prompt: findings now carry a real priority, not
 * the hardcoded "medium" every finding got before this feature). Derived
 * from the two things already known the moment a finding is raised — how
 * badly the requirement failed, and whether it's one of the 10 key
 * requirements (lib/rules/constants.ts) — never asked of the model, never
 * left to the assessor to type in: a requirement's key status and a
 * decision's rating are both fixed vocabulary the code already has.
 *
 * Not Compliant on a key requirement is "high" — the worker welfare gap
 * a key requirement exists to catch, unresolved. Everything else that
 * still fails is "medium" or "low" by the same two-factor read: a key
 * requirement rated only Partial is treated the same as a non-key
 * requirement rated Not Compliant (both "medium"), and a non-key
 * requirement rated Partial is the one combination left as "low". See
 * docs/decisions.md.
 */
export function derivedFindingPriority(status: ComplianceRating, requirementSlNo: number): FindingPriority {
  const isKey = isKeyRequirement(requirementSlNo);
  const isNotCompliant = status === "Not Compliant";

  if (isNotCompliant && isKey) return "high";
  if (isNotCompliant || isKey) return "medium";
  return "low";
}
