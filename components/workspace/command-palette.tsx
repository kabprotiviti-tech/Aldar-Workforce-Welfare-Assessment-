"use client";

import { useEffect, useRef, useState } from "react";
import type { RequirementAssessment } from "@/lib/rules/types";
import { titleFor } from "@/lib/workspace-sample-data";

type Props = {
  requirements: RequirementAssessment[];
  onSelect: (requirementNumber: number) => void;
  onClose: () => void;
};

export function CommandPalette({ requirements, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = requirements.filter((requirement) => {
    const haystack = `requirement ${requirement.requirementNumber} ${titleFor(requirement.requirementNumber)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-overlay" />
      <div
        role="dialog"
        aria-label="Command palette"
        className="shadow-float relative w-full max-w-lg border border-hairline bg-surface"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to a requirement…"
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm text-ink outline-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              onSelect(matches[0].requirementNumber);
            }
          }}
        />
        <ul className="max-h-72 overflow-y-auto">
          {matches.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-secondary">
              No requirement matches &ldquo;{query}&rdquo;.
            </li>
          )}
          {matches.map((requirement) => (
            <li key={requirement.requirementNumber}>
              <button
                type="button"
                onClick={() => onSelect(requirement.requirementNumber)}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-ink hover:bg-bg"
              >
                <span>
                  Requirement {requirement.requirementNumber}: {titleFor(requirement.requirementNumber)}
                </span>
                <span className="text-xs text-ink-secondary">{requirement.rating}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
