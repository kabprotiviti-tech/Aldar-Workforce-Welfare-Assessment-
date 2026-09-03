import Link from "next/link";
import { completionOf, type ItemDecision } from "@/lib/assessment/decision";
import { Pill, type PillTone } from "@/components/ds/pill";

export interface RequirementNavItem extends ItemDecision {
  assessmentItemId: string;
}

const COMPLETION_MARK: Record<ReturnType<typeof completionOf>, { label: string; tone: PillTone }> = {
  complete: { label: "Done", tone: "ok" },
  incomplete: { label: "Needs detail", tone: "warn" },
  not_started: { label: "Not started", tone: "neutral" },
};

const STATUS_TONE: Record<string, PillTone> = {
  Compliant: "ok",
  Partial: "warn",
  "Not Compliant": "bad",
  "Not Applicable": "neutral",
};

/**
 * Navigation across all 23 requirements with status, key flag and
 * completion (this prompt). Completion is the column that earns its
 * place: "status chosen but the required remark is still missing" is
 * exactly what an assessor loses track of, and it is invisible from the
 * status alone.
 */
export function RequirementNav({
  assessmentId,
  items,
  currentItemId,
}: {
  assessmentId: string;
  items: RequirementNavItem[];
  currentItemId: string;
}) {
  return (
    <nav aria-label="Requirements" className="grid gap-1">
      {items.map((item) => {
        const completion = COMPLETION_MARK[completionOf(item)];
        const isCurrent = item.assessmentItemId === currentItemId;
        return (
          <Link
            key={item.assessmentItemId}
            href={`/app/assessments/${assessmentId}/requirements/${item.assessmentItemId}`}
            aria-current={isCurrent ? "page" : undefined}
            className={`ds-focus-ring rounded-ds-control border px-2.5 py-2 text-left text-xs transition-colors duration-150 ${
              isCurrent ? "border-ds-accent bg-ds-accent-soft" : "border-ds-line bg-ds-surface hover:border-ds-accent"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-ds-ink">
                {item.requirementSlNo}. {item.requirementTitle}
              </span>
              {item.isKey && (
                <span className="shrink-0 rounded-full border border-ds-accent px-1.5 text-[10px] font-semibold uppercase tracking-wide text-ds-accent-2">
                  Key
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {item.status && <Pill tone={STATUS_TONE[item.status] ?? "neutral"}>{item.status}</Pill>}
              <Pill tone={completion.tone}>{completion.label}</Pill>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
