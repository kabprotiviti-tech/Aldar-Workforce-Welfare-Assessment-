"use client";

import { useEffect, useRef } from "react";
import type { ComplianceRating } from "@/lib/rules/constants";
import { COMPLIANCE_RATINGS } from "@/lib/rules/constants";
import type { RequirementAssessment } from "@/lib/rules/types";
import { validateRatedEntity } from "@/lib/rules/validation";
import { titleFor } from "@/lib/workspace-sample-data";

type Props = {
  requirement: RequirementAssessment;
  onClose: () => void;
  onChange: (patch: Partial<RequirementAssessment>) => void;
};

const RATING_KEYS: Record<ComplianceRating, string> = {
  Compliant: "1",
  Partial: "2",
  "Not Compliant": "3",
  "Not Applicable": "4",
};

export function RequirementDrawer({ requirement, onClose, onChange }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [requirement.requirementNumber]);

  const issues = validateRatedEntity(requirement);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-overlay"
      />
      <aside
        role="dialog"
        aria-label={`Requirement ${requirement.requirementNumber}`}
        className="shadow-float relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-hairline bg-surface transition-transform duration-structural ease-instrument"
      >
        <div className="flex items-start justify-between border-b border-hairline px-6 py-4">
          <div>
            <p className="text-xs text-ink-secondary">Requirement {requirement.requirementNumber}</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">
              {titleFor(requirement.requirementNumber)}
            </h3>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-control border border-hairline px-2 py-1 text-sm text-ink-secondary hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="flex-1 px-6 py-5">
          <fieldset>
            <legend className="text-xs text-ink-secondary">Compliance status</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {COMPLIANCE_RATINGS.map((rating) => (
                <button
                  key={rating}
                  type="button"
                  aria-pressed={requirement.rating === rating}
                  onClick={() => onChange({ rating })}
                  className={[
                    "rounded-control border px-3 py-2 text-left text-sm transition-colors duration-micro ease-instrument",
                    requirement.rating === rating
                      ? "border-ink text-ink"
                      : "border-hairline text-ink-secondary hover:border-ink",
                  ].join(" ")}
                >
                  <span className="text-ink-secondary">{RATING_KEYS[rating]}</span>{" "}
                  {rating}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="mt-6 block">
            <span className="text-xs text-ink-secondary">Remark</span>
            <textarea
              value={requirement.remark ?? ""}
              onChange={(event) => onChange({ remark: event.target.value })}
              rows={3}
              className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-xs text-ink-secondary">Action required for closure</span>
            <textarea
              value={requirement.actionRequiredForClosure ?? ""}
              onChange={(event) => onChange({ actionRequiredForClosure: event.target.value })}
              rows={2}
              className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          {issues.length > 0 && (
            <ul className="mt-4 space-y-1">
              {issues.map((issue) => (
                <li key={issue.field} className="text-sm text-not-compliant">
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
