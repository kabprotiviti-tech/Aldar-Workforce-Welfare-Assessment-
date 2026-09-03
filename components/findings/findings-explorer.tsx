"use client";

import { useMemo, useState } from "react";
import type { DbModule } from "@/lib/db/common";
import type { FindingPriority, FindingStatus } from "@/lib/db/findings";
import { EmptyState } from "@/components/ds/empty-state";
import { FilterChip } from "@/components/ds/filter-chip";
import { Pill, type PillTone } from "@/components/ds/pill";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ds/table";
import { Drawer } from "@/components/ds/drawer";
import { FindingDetail } from "@/components/findings/finding-detail";

export interface FindingRow {
  id: string;
  title: string;
  priority: FindingPriority;
  status: FindingStatus;
  dueDate: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerOrganisation: string | null;
  ownerContactId: string | null;
  repeatOfFindingId: string | null;
  createdAt: string;
  closedAt: string | null;
  reviewerDecision: string | null;
  reviewerDecisionReason: string | null;
  closureEvidenceText: string | null;
  module: DbModule;
  subjectCode: string;
  entityId: string;
  entityName: string;
  facilityName: string | null;
  requirementId: string;
  requirementSlNo: number;
  requirementTitle: string;
  actionRequired: string | null;
  evidence: { id: string; originalName: string; storagePath: string; uploadedAt: string }[];
  isOverdue: boolean;
}

export interface FindingEventRow {
  findingId: string;
  eventType: string;
  note: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface EntityContactOption {
  id: string;
  entityId: string;
  name: string;
  email: string | null;
}

const MODULE_LABEL: Record<DbModule, string> = {
  employment_practices: "Employment Practices",
  onboarding: "Onboarding",
  accommodation: "Accommodation",
};

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  evidence_submitted: "Evidence submitted",
  under_review: "Under review",
  closed: "Closed",
};

const STATUS_TONE: Record<FindingStatus, PillTone> = {
  open: "bad",
  in_progress: "warn",
  evidence_submitted: "info",
  under_review: "info",
  closed: "ok",
};

const PRIORITY_TONE: Record<FindingPriority, PillTone> = { high: "bad", medium: "warn", low: "neutral" };

type Filter = "all" | string;

/**
 * Findings & Actions (this prompt): filters (programme, entity, priority,
 * status, overdue, repeat) over one already-fetched list — filtering
 * client-side, the same shape as the evidence library, since the whole
 * staff-visible set is small enough to hold in memory at once. Clicking
 * a row opens the detail drawer (components/findings/finding-detail.tsx).
 */
export function FindingsExplorer({
  findings,
  events,
  contacts,
  initialOpenId = null,
}: {
  findings: FindingRow[];
  events: FindingEventRow[];
  contacts: EntityContactOption[];
  /** Drill-down from elsewhere (the executive overview's attention list, the monitoring view) — opens this finding's detail drawer on load, the same row a click would open. */
  initialOpenId?: string | null;
}) {
  const [module, setModule] = useState<Filter>("all");
  const [entityId, setEntityId] = useState<Filter>("all");
  const [priority, setPriority] = useState<Filter>("all");
  const [status, setStatus] = useState<Filter>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialOpenId);

  const entities = useMemo(() => {
    const byId = new Map<string, string>();
    for (const f of findings) byId.set(f.entityId, f.entityName);
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [findings]);

  const filtered = findings.filter(
    (f) =>
      (module === "all" || f.module === module) &&
      (entityId === "all" || f.entityId === entityId) &&
      (priority === "all" || f.priority === priority) &&
      (status === "all" || f.status === status) &&
      (!overdueOnly || f.isOverdue) &&
      (!repeatOnly || f.repeatOfFindingId !== null),
  );

  const selected = selectedId ? findings.find((f) => f.id === selectedId) ?? null : null;

  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Findings &amp; Actions</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Open findings, their owners, and closure evidence.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <FilterChip selected={module === "all"} onClick={() => setModule("all")}>
          All programmes
        </FilterChip>
        {(Object.keys(MODULE_LABEL) as DbModule[]).map((m) => (
          <FilterChip key={m} selected={module === m} onClick={() => setModule(m)}>
            {MODULE_LABEL[m]}
          </FilterChip>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-3 py-1.5 text-sm text-ds-ink"
        >
          <option value="all">All entities</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        {(["high", "medium", "low"] as FindingPriority[]).map((p) => (
          <FilterChip key={p} selected={priority === p} onClick={() => setPriority(priority === p ? "all" : p)}>
            {p} priority
          </FilterChip>
        ))}

        {(Object.keys(STATUS_LABEL) as FindingStatus[]).map((s) => (
          <FilterChip key={s} selected={status === s} onClick={() => setStatus(status === s ? "all" : s)}>
            {STATUS_LABEL[s]}
          </FilterChip>
        ))}

        <FilterChip selected={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
          Overdue
        </FilterChip>
        <FilterChip selected={repeatOnly} onClick={() => setRepeatOnly((v) => !v)}>
          Repeat
        </FilterChip>
      </div>

      <div className="mt-4">
        {filtered.length === 0 ? (
          <EmptyState title="No findings match these filters" description="Try widening the filters above." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Finding</TableHeaderCell>
                <TableHeaderCell>Entity</TableHeaderCell>
                <TableHeaderCell>Priority</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Due</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((f) => (
                <TableRow key={f.id} className="cursor-pointer hover:bg-ds-surface-2" onClick={() => setSelectedId(f.id)}>
                  <TableCell>
                    <p className="font-medium text-ds-ink">{f.title}</p>
                    <p className="text-xs text-ds-ink-2">
                      {f.subjectCode} &middot; {f.requirementTitle}
                      {f.repeatOfFindingId && " · repeat"}
                    </p>
                  </TableCell>
                  <TableCell>{f.entityName}</TableCell>
                  <TableCell>
                    <Pill tone={PRIORITY_TONE[f.priority]}>{f.priority}</Pill>
                  </TableCell>
                  <TableCell>
                    <Pill tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Pill>
                  </TableCell>
                  <TableCell>
                    <span className={f.isOverdue ? "font-medium text-ds-bad" : "text-ds-ink"}>{f.dueDate ?? "—"}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Drawer open={selected !== null} onClose={() => setSelectedId(null)} title={selected?.title ?? "Finding"}>
        {selected && (
          <FindingDetail
            finding={selected}
            history={findings.filter((f) => f.entityId === selected.entityId && f.requirementId === selected.requirementId)}
            events={events.filter((e) => e.findingId === selected.id)}
            contacts={contacts.filter((c) => c.entityId === selected.entityId)}
          />
        )}
      </Drawer>
    </div>
  );
}
