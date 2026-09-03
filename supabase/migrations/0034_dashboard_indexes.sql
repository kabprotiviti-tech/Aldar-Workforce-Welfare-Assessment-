-- Indexes the executive/monitoring dashboards need to stay under their
-- 1.5-second budget on a 185-assessment cycle (this prompt). Until now,
-- almost nothing in this schema outside the extraction/observation/
-- inspection queues had a secondary index (docs/decisions.md
-- established that the earlier dashboard-infra research: this is the
-- first phase whose read pattern — portfolio-wide aggregation across
-- assessments/assessment_items/findings/evidence_files/qa_queries,
-- rather than one assessment at a time — actually needs them.

-- assessments: cycle-scoped listings (already existing pages), and the
-- dashboard's own module/owner/report-due-date filters.
create index assessments_cycle_id_idx on public.assessments (cycle_id) where deleted_at is null;
create index assessments_module_idx on public.assessments (module) where deleted_at is null;
create index assessments_owner_id_idx on public.assessments (owner_id) where deleted_at is null;
-- Partial: "at-risk deadlines" only ever looks at assessments not yet
-- issued, so a full index on every historical report_due_date would
-- carry rows the dashboard never queries.
create index assessments_report_due_date_idx on public.assessments (report_due_date)
  where deleted_at is null and issued_at is null;

-- assessment_items: joined from every assessment-scoped read in this
-- codebase (reports, tracker, dashboards alike) — the one index missing
-- everywhere until now.
create index assessment_items_assessment_id_idx on public.assessment_items (assessment_id);
create index assessment_items_requirement_id_idx on public.assessment_items (requirement_id);

-- findings: entity-scoped (client_viewer's own reads), status-filtered
-- (open-findings counts), due-date-filtered (action ageing), and
-- repeat-linked (repeat-findings signal).
create index findings_entity_id_idx on public.findings (entity_id) where deleted_at is null;
create index findings_status_idx on public.findings (status) where deleted_at is null;
create index findings_due_date_idx on public.findings (due_date) where deleted_at is null and status <> 'closed';
create index findings_repeat_of_finding_id_idx on public.findings (repeat_of_finding_id) where repeat_of_finding_id is not null;

-- evidence_files: assessment-scoped, and the "awaiting review" signal's
-- own status filter.
create index evidence_files_assessment_id_idx on public.evidence_files (assessment_id);
create index evidence_files_review_status_idx on public.evidence_files (review_status) where review_status in ('received', 'in_review');

-- qa_queries: assessment-scoped, open-only (the QA panel already reads
-- this per-assessment; the dashboard reads it portfolio-wide).
create index qa_queries_assessment_id_idx on public.qa_queries (assessment_id) where status = 'open';
