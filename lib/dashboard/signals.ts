/**
 * The executive overview's "attention list" (this prompt: "evidence
 * awaiting review, overdue actions, at-risk deadlines, repeat findings,
 * expiring certificates"). Each signal is a plain, dated filter over
 * rows this schema already stores — never a forecast or a trend line.
 * `query` states exactly which stored condition produced it, so the
 * signal can never be read as a prediction: it's what the query returns
 * right now, nothing more. Every item carries the id of its underlying
 * row so the UI can link straight to it — "no unopenable aggregate"
 * (this prompt's acceptance criterion) starts here.
 */

export type SignalKind = "evidence_awaiting_review" | "overdue_action" | "at_risk_deadline" | "repeat_finding" | "expiring_certificate";

export interface SignalItem {
  id: string;
  label: string;
  detail: string;
  href: string;
}

export interface Signal {
  kind: SignalKind;
  title: string;
  /** The exact, plain-language filter behind this signal's rows — no prediction, just what's true right now. */
  query: string;
  items: SignalItem[];
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000));
}

export interface EvidenceAwaitingReviewRow {
  id: string;
  originalName: string;
  subjectCode: string;
  assessmentId: string;
}

export function buildEvidenceAwaitingReviewSignal(rows: readonly EvidenceAwaitingReviewRow[]): Signal {
  return {
    kind: "evidence_awaiting_review",
    title: "Evidence awaiting review",
    query: "evidence_files where review_status in ('received', 'in_review')",
    items: rows.map((row) => ({
      id: row.id,
      label: row.originalName,
      detail: row.subjectCode,
      href: `/app/assessments/${row.assessmentId}/evidence`,
    })),
  };
}

export interface OverdueActionRow {
  id: string;
  title: string;
  dueDate: string;
  subjectCode: string;
}

export function buildOverdueActionsSignal(rows: readonly OverdueActionRow[], todayIso: string): Signal {
  const overdue = rows.filter((row) => row.dueDate < todayIso);
  return {
    kind: "overdue_action",
    title: "Overdue actions",
    query: "findings where status <> 'closed' and due_date < today",
    items: overdue.map((row) => ({
      id: row.id,
      label: row.title,
      detail: `${row.subjectCode} · due ${row.dueDate}`,
      href: `/app/findings?open=${row.id}`,
    })),
  };
}

export interface AtRiskDeadlineRow {
  assessmentId: string;
  subjectCode: string;
  reportDueDate: string;
}

/** "At risk" (this prompt) — assumed as within 7 days of the report due date, or already past it, with no report issued yet. Documented assumption, see docs/decisions.md. */
export const AT_RISK_DEADLINE_WINDOW_DAYS = 7;

export function buildAtRiskDeadlinesSignal(rows: readonly AtRiskDeadlineRow[], todayIso: string): Signal {
  const atRisk = rows.filter((row) => daysBetween(todayIso, row.reportDueDate) <= AT_RISK_DEADLINE_WINDOW_DAYS);
  return {
    kind: "at_risk_deadline",
    title: "At-risk deadlines",
    query: `assessments where issued_at is null and report_due_date <= today + ${AT_RISK_DEADLINE_WINDOW_DAYS} days`,
    items: atRisk.map((row) => ({
      id: row.assessmentId,
      label: row.subjectCode,
      detail: `Report due ${row.reportDueDate}`,
      href: `/app/assessments/${row.assessmentId}`,
    })),
  };
}

export interface RepeatFindingRow {
  id: string;
  title: string;
  subjectCode: string;
  repeatOfFindingId: string;
}

export function buildRepeatFindingsSignal(rows: readonly RepeatFindingRow[]): Signal {
  return {
    kind: "repeat_finding",
    title: "Repeat findings",
    query: "findings where status <> 'closed' and repeat_of_finding_id is not null",
    items: rows.map((row) => ({
      id: row.id,
      label: row.title,
      detail: `${row.subjectCode} · repeats a prior finding`,
      href: `/app/findings?open=${row.id}`,
    })),
  };
}

export interface ExpiringCertificateRow {
  assessmentItemId: string;
  assessmentId: string;
  subjectCode: string;
  certificateType: string;
  validTo: string;
}

/** How far ahead a certificate's expiry counts as "expiring" — assumed at 30 days, matching no particular client-stated threshold. Documented assumption, see docs/decisions.md. */
export const EXPIRING_CERTIFICATE_WINDOW_DAYS = 30;

export function buildExpiringCertificatesSignal(rows: readonly ExpiringCertificateRow[], todayIso: string): Signal {
  const expiring = rows.filter((row) => daysBetween(todayIso, row.validTo) <= EXPIRING_CERTIFICATE_WINDOW_DAYS);
  return {
    kind: "expiring_certificate",
    title: "Expiring certificates",
    query: `assessment_items.quantitative certificates where valid_to <= today + ${EXPIRING_CERTIFICATE_WINDOW_DAYS} days`,
    items: expiring.map((row) => ({
      id: row.assessmentItemId,
      label: `${row.certificateType} — ${row.subjectCode}`,
      detail: `Expires ${row.validTo}`,
      href: `/app/assessments/${row.assessmentId}`,
    })),
  };
}
