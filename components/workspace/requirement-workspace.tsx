"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComplianceRating } from "@/lib/rules/constants";
import type { RequirementAssessment } from "@/lib/rules/types";
import { validateRatedEntity } from "@/lib/rules/validation";
import {
  computeComplianceAdjustedForNotAssessedPercent,
  computeOverallCompliancePercent,
} from "@/lib/rules/aggregate";
import {
  SAMPLE_CYCLE_LABEL,
  SAMPLE_ENTITY_NAME,
  SAMPLE_REQUIREMENTS,
  titleFor,
} from "@/lib/workspace-sample-data";
import { RatingBadge } from "@/components/workspace/rating-badge";
import { ShortcutsPanel } from "@/components/workspace/shortcuts-panel";
import { RequirementDrawer } from "@/components/workspace/requirement-drawer";
import { CommandPalette } from "@/components/workspace/command-palette";

const RATING_KEYS: Record<string, ComplianceRating> = {
  "1": "Compliant",
  "2": "Partial",
  "3": "Not Compliant",
  "4": "Not Applicable",
};

type UndoState = {
  requirementNumber: number;
  previous: RequirementAssessment;
  label: string;
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
}

export function RequirementWorkspace() {
  const [requirements, setRequirements] = useState<RequirementAssessment[]>(() =>
    SAMPLE_REQUIREMENTS.map((r) => ({ ...r })),
  );
  const [activeNumber, setActiveNumber] = useState(1);
  const [query, setQuery] = useState("");
  const [drawerNumber, setDrawerNumber] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return requirements;
    return requirements.filter((r) =>
      `requirement ${r.requirementNumber} ${titleFor(r.requirementNumber)} ${r.rating}`
        .toLowerCase()
        .includes(needle),
    );
  }, [requirements, query]);

  const overallPercent = computeOverallCompliancePercent(requirements);
  const adjustedPercent = computeComplianceAdjustedForNotAssessedPercent(requirements);

  function updateRequirement(requirementNumber: number, patch: Partial<RequirementAssessment>) {
    setRequirements((prev) =>
      prev.map((r) => (r.requirementNumber === requirementNumber ? { ...r, ...patch } : r)),
    );
  }

  function setRatingWithUndo(requirementNumber: number, rating: ComplianceRating) {
    const previous = requirements.find((r) => r.requirementNumber === requirementNumber);
    if (!previous || previous.rating === rating) return;
    updateRequirement(requirementNumber, { rating });
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndo({ requirementNumber, previous, label: `Requirement ${requirementNumber} set to ${rating}` });
    undoTimeoutRef.current = setTimeout(() => setUndo(null), 6000);
  }

  function handleUndo() {
    if (!undo) return;
    updateRequirement(undo.requirementNumber, undo.previous);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndo(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isCommandK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCommandK) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (paletteOpen) {
        if (event.key === "Escape") setPaletteOpen(false);
        return;
      }

      if (drawerNumber !== null) {
        if (event.key === "Escape") setDrawerNumber(null);
        return;
      }

      if (event.key === "Escape") {
        setQuery("");
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const index = filtered.findIndex((r) => r.requirementNumber === activeNumber);
        const next = filtered[Math.min(filtered.length - 1, Math.max(0, index) + 1)];
        if (next) setActiveNumber(next.requirementNumber);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const index = filtered.findIndex((r) => r.requirementNumber === activeNumber);
        const prev = filtered[Math.max(0, index - 1)];
        if (prev) setActiveNumber(prev.requirementNumber);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setDrawerNumber(activeNumber);
        return;
      }
      const rating = RATING_KEYS[event.key];
      if (rating) {
        setRatingWithUndo(activeNumber, rating);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeNumber, filtered, paletteOpen, drawerNumber, requirements]);

  const drawerRequirement = requirements.find((r) => r.requirementNumber === drawerNumber) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-hairline pb-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">{SAMPLE_ENTITY_NAME}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{SAMPLE_CYCLE_LABEL}</p>
        </div>
        <div className="flex gap-8">
          <div>
            <p className="text-xs text-ink-secondary">Overall compliance</p>
            <p className="numeral-display text-2xl text-ink">
              {overallPercent === null ? "—" : `${overallPercent}%`}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-secondary">Adjusted for not assessed</p>
            <p className="numeral-display text-2xl text-ink">
              {adjustedPercent === null ? "—" : `${adjustedPercent}%`}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <label className="flex-1">
          <span className="sr-only">Search requirements</span>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search requirements — press / to focus"
            className="w-full max-w-sm rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-control border border-hairline px-3 py-2 text-sm text-ink-secondary hover:text-ink"
          >
            Ctrl / ⌘ K
          </button>
          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            className="rounded-control border border-hairline px-3 py-2 text-sm text-ink-secondary hover:text-ink"
            aria-expanded={showShortcuts}
          >
            Shortcuts
          </button>
        </div>
      </div>

      {showShortcuts && <div className="mt-4">
        <ShortcutsPanel />
      </div>}

      <div className="mt-6 max-h-[60vh] overflow-auto border border-hairline">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-hairline text-xs text-ink-secondary">
              <th className="w-14 px-3 py-2 text-right font-medium">No.</th>
              <th className="px-3 py-2 font-medium">Requirement</th>
              <th className="w-40 px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Remark</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-ink-secondary">
                  No requirements match &ldquo;{query}&rdquo;.{" "}
                  <button type="button" onClick={() => setQuery("")} className="text-ink underline">
                    Clear the search
                  </button>{" "}
                  to see all 23.
                </td>
              </tr>
            )}
            {filtered.map((requirement) => {
              const isActive = requirement.requirementNumber === activeNumber;
              const issues = validateRatedEntity(requirement);
              return (
                <tr
                  key={requirement.requirementNumber}
                  onClick={() => setActiveNumber(requirement.requirementNumber)}
                  onDoubleClick={() => setDrawerNumber(requirement.requirementNumber)}
                  className={[
                    "cursor-pointer border-b border-hairline last:border-b-0",
                    isActive ? "border-l-2 border-l-accent" : "",
                  ].join(" ")}
                >
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                    {requirement.requirementNumber}
                  </td>
                  <td className="px-3 py-2 text-ink">{titleFor(requirement.requirementNumber)}</td>
                  <td className="px-3 py-2">
                    <RatingBadge rating={requirement.rating} />
                    {issues.length > 0 && (
                      <p className="mt-0.5 text-xs text-not-compliant">Needs a closure action</p>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-ink-secondary">
                    {requirement.remark || "No remark yet"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-ink-secondary">
        Interaction prototype on sample data — not yet connected to a database.
      </p>

      {drawerRequirement && (
        <RequirementDrawer
          requirement={drawerRequirement}
          onClose={() => setDrawerNumber(null)}
          onChange={(patch) => updateRequirement(drawerRequirement.requirementNumber, patch)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          requirements={requirements}
          onClose={() => setPaletteOpen(false)}
          onSelect={(requirementNumber) => {
            setActiveNumber(requirementNumber);
            setDrawerNumber(requirementNumber);
            setPaletteOpen(false);
          }}
        />
      )}

      {undo && (
        <div className="shadow-float fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4 border border-hairline bg-surface px-4 py-3">
          <span className="text-sm text-ink">{undo.label}</span>
          <button type="button" onClick={handleUndo} className="text-sm font-medium text-accent">
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
