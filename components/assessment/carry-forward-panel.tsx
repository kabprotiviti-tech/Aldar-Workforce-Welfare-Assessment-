"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkCarryForwardEligibility, previousFindingState } from "@/lib/assessment/carry-forward";
import { markNotAssessedThisCycle } from "@/lib/assessment/actions";
import type { ComplianceRating } from "@/lib/rules/constants";
import type { DbModule } from "@/lib/db/common";
import type { FindingStatus } from "@/lib/db/findings";
import { Button } from "@/components/ds/button";
import { Pill, type PillTone } from "@/components/ds/pill";

const STATUS_TONE: Record<ComplianceRating, PillTone> = { Compliant: "ok", Partial: "warn", "Not Compliant": "bad", "Not Applicable": "neutral" };

/**
 * The previous cycle, surfaced where the assessor is about to decide
 * this cycle (this prompt: "prior open actions surfaced at the top of
 * the assessor's workspace for each requirement").
 *
 * Shown only while nothing has been decided this cycle yet
 * (`compliance_status` still null) — once a status exists, whether from
 * a genuine reassessment or from confirming carry-forward, the decision
 * form below is the current record and this panel would just be
 * duplicating it.
 */
export function CarryForwardPanel({
  assessmentId,
  assessmentItemId,
  module,
  currentStatus,
  previousStatus,
  previousRemarks,
  previousActionRequired,
  carrySourceFindingStatus,
}: {
  assessmentId: string;
  assessmentItemId: string;
  module: DbModule;
  currentStatus: ComplianceRating | null;
  previousStatus: ComplianceRating | null;
  previousRemarks: string | null;
  previousActionRequired: string | null;
  /** The status of the most recent finding tied to the item this one carries forward from, if any. */
  carrySourceFindingStatus: FindingStatus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (previousStatus === null || currentStatus !== null) {
    return null;
  }

  const eligibility = checkCarryForwardEligibility(previousStatus, previousFindingState(carrySourceFindingStatus));

  return (
    <section className="rounded-ds-card border border-ds-line bg-ds-surface-2 p-4">
      <h2 className="text-sm font-semibold text-ds-ink">Previous cycle</h2>
      <div className="mt-1.5 flex items-center gap-2">
        <Pill tone={STATUS_TONE[previousStatus]}>{previousStatus}</Pill>
        <span className="text-xs text-ds-ink-2">not yet assessed this cycle</span>
      </div>
      {previousRemarks && <p className="mt-2 text-sm text-ds-ink">{previousRemarks}</p>}
      {previousActionRequired && previousActionRequired !== "N/A" && (
        <p className="mt-2 rounded-ds-control border-l-4 border-l-ds-warn bg-ds-surface px-2.5 py-1.5 text-sm text-ds-ink">
          <span className="font-medium">Open action from last cycle: </span>
          {previousActionRequired}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={pending || !eligibility.eligible}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await markNotAssessedThisCycle(assessmentItemId, assessmentId, { module });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              router.refresh();
            });
          }}
        >
          Not assessed this cycle — carry forward
        </Button>
        <span className="text-xs text-ds-ink-2">or record a fresh decision below.</span>
      </div>
      {!eligibility.eligible && <p className="mt-2 text-xs text-ds-warn">{eligibility.reason}</p>}
      {error && <p className="mt-2 text-xs text-ds-warn">{error}</p>}
    </section>
  );
}
