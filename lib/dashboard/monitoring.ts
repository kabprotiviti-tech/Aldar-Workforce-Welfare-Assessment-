import type { ComplianceRating } from "@/lib/rules/constants";

/**
 * The monitoring view (this prompt): compliance by requirement across
 * cycles, repeat findings by requirement and entity, action ageing
 * buckets, and a full lineage view. Every function here is pure — the
 * *-supabase.ts adapter gathers rows, this module only groups, buckets
 * and orders them. No trend is extrapolated forward: "across cycles"
 * means the historical tally per cycle, never a projection.
 */

// ---- Compliance by requirement, across cycles ----

export interface RequirementCycleRatingRow {
  cycleYear: number;
  requirementSlNo: number;
  requirementTitle: string;
  rating: ComplianceRating | null;
}

export interface CycleRatingCounts {
  cycleYear: number;
  compliant: number;
  partial: number;
  notCompliant: number;
  notApplicable: number;
  notAssessed: number;
}

export interface RequirementTrend {
  requirementSlNo: number;
  requirementTitle: string;
  byCycleYear: CycleRatingCounts[];
}

function emptyCounts(cycleYear: number): CycleRatingCounts {
  return { cycleYear, compliant: 0, partial: 0, notCompliant: 0, notApplicable: 0, notAssessed: 0 };
}

/** Ratings for every requirement, grouped by requirement then broken down per cycle year — a real historical tally, sorted oldest cycle first so a reader sees change over time in reading order. */
export function buildComplianceByRequirementAcrossCycles(rows: readonly RequirementCycleRatingRow[]): RequirementTrend[] {
  const byRequirement = new Map<number, { title: string; byYear: Map<number, CycleRatingCounts> }>();

  for (const row of rows) {
    const entry = byRequirement.get(row.requirementSlNo) ?? { title: row.requirementTitle, byYear: new Map() };
    const counts = entry.byYear.get(row.cycleYear) ?? emptyCounts(row.cycleYear);
    if (row.rating === "Compliant") counts.compliant += 1;
    else if (row.rating === "Partial") counts.partial += 1;
    else if (row.rating === "Not Compliant") counts.notCompliant += 1;
    else if (row.rating === "Not Applicable") counts.notApplicable += 1;
    else counts.notAssessed += 1;
    entry.byYear.set(row.cycleYear, counts);
    byRequirement.set(row.requirementSlNo, entry);
  }

  return Array.from(byRequirement.entries())
    .map(([requirementSlNo, entry]) => ({
      requirementSlNo,
      requirementTitle: entry.title,
      byCycleYear: Array.from(entry.byYear.values()).sort((a, b) => a.cycleYear - b.cycleYear),
    }))
    .sort((a, b) => a.requirementSlNo - b.requirementSlNo);
}

// ---- Repeat findings by requirement and entity ----

export interface RepeatFindingRow {
  findingId: string;
  requirementSlNo: number;
  requirementTitle: string;
  entityId: string;
  entityName: string;
}

export interface RepeatFindingsGroup {
  requirementSlNo: number;
  requirementTitle: string;
  entityId: string;
  entityName: string;
  repeatCount: number;
  findingIds: string[];
}

/** Rows are assumed already filtered to open, repeat-linked findings — this groups them by (requirement, entity) so a reader sees where the same gap keeps recurring for the same entity, not just a flat count. */
export function buildRepeatFindingsByRequirementAndEntity(rows: readonly RepeatFindingRow[]): RepeatFindingsGroup[] {
  const groups = new Map<string, RepeatFindingsGroup>();
  for (const row of rows) {
    const key = `${row.requirementSlNo}:${row.entityId}`;
    const group = groups.get(key) ?? {
      requirementSlNo: row.requirementSlNo,
      requirementTitle: row.requirementTitle,
      entityId: row.entityId,
      entityName: row.entityName,
      repeatCount: 0,
      findingIds: [],
    };
    group.repeatCount += 1;
    group.findingIds.push(row.findingId);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.repeatCount - a.repeatCount);
}

// ---- Action ageing buckets ----

export const ACTION_AGEING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type ActionAgeingBucket = (typeof ACTION_AGEING_BUCKETS)[number];

export interface OpenActionRow {
  findingId: string;
  title: string;
  subjectCode: string;
  createdAt: string;
}

export interface ActionAgeingGroup {
  bucket: ActionAgeingBucket;
  count: number;
  items: { id: string; label: string; detail: string }[];
}

function ageingBucketForDays(daysOpen: number): ActionAgeingBucket {
  if (daysOpen <= 30) return "0-30";
  if (daysOpen <= 60) return "31-60";
  if (daysOpen <= 90) return "61-90";
  return "90+";
}

/** How long every currently-open finding has been open, bucketed — "ageing" reads as time since raised (createdAt), not time past due, since an action with no due date still ages. */
export function buildActionAgeingBuckets(rows: readonly OpenActionRow[], todayIso: string): ActionAgeingGroup[] {
  const byBucket = new Map<ActionAgeingBucket, ActionAgeingGroup["items"]>(ACTION_AGEING_BUCKETS.map((bucket) => [bucket, []]));
  for (const row of rows) {
    const daysOpen = Math.round((new Date(`${todayIso}T00:00:00Z`).getTime() - new Date(row.createdAt).getTime()) / (24 * 60 * 60 * 1000));
    const bucket = ageingBucketForDays(Math.max(daysOpen, 0));
    byBucket.get(bucket)!.push({ id: row.findingId, label: row.title, detail: `${row.subjectCode} · open ${Math.max(daysOpen, 0)} days` });
  }
  return ACTION_AGEING_BUCKETS.map((bucket) => ({ bucket, count: byBucket.get(bucket)!.length, items: byBucket.get(bucket)! }));
}

// ---- Lineage ----

export type LineageEventKind =
  | "rfi_issued"
  | "rfi_completed"
  | "evidence_uploaded"
  | "item_decided"
  | "finding_raised"
  | "finding_closed"
  | "report_generated"
  | "report_issued";

export interface LineageEvent {
  kind: LineageEventKind;
  at: string;
  label: string;
  detail: string | null;
}

/**
 * One assessment's full trail — RFI through to report (this prompt's
 * "full lineage view") — built from events the adapter has already
 * labelled per source table (RFIs, evidence, decided items, findings,
 * reports); this function's only job is the chronological merge, the
 * same "gather, then order" split as lib/qa/timeline.ts's narrower
 * governance-only timeline.
 */
export function buildAssessmentLineage(events: readonly LineageEvent[]): LineageEvent[] {
  return [...events].sort((a, b) => a.at.localeCompare(b.at));
}
