-- Visit scheduling and audit-number decimals.
--
-- The brief distinguishes three visit-related dates that 0004_assessments.sql
-- only had two of: a *proposed* date (the consultancy's initial offer),
-- a *confirmed* date (once the entity/facility agrees — may differ from the
-- proposal), and the *actual* date the visit really happened (may differ
-- again, e.g. a last-minute reschedule). planned_visit_date is renamed to
-- proposed_visit_date and confirmed_visit_date is added; actual_visit_date
-- (already present) is untouched — report_due_date is computed from it,
-- not from either scheduling date, since only the actual visit date is
-- knowable to have happened. See docs/decisions.md.

alter table public.assessments rename column planned_visit_date to proposed_visit_date;
alter table public.assessments add column confirmed_visit_date date;

-- Some facilities sit under a regulatory body (e.g. AD Ports) and need
-- permission to visit (CONTEXT.md/this prompt). facilities.access_permission_required
-- is the site's standing attribute; this column is the copy an assessment
-- takes at generation time (lib/scheduling/generate-cycle.ts) — editable
-- independently afterward, since a specific visit's permission status is a
-- scheduling fact, not something that should silently change if the
-- facility's own flag is edited later. Always false for Employment
-- Practices/Onboarding assessments, which have no facility_id.
alter table public.assessments add column permission_required boolean not null default false;

-- The client's supporting access letter for a permission-required visit is
-- an uploaded document like any other — reuses public.evidence_files
-- (document_class = 'access_letter') rather than a dedicated column/table.
-- See docs/decisions.md.

-- Audit numbers increment per entity/module as whole numbers (1, 2, 3, ...)
-- for full audits, with a follow-up between two full audits taking the
-- ".5" in between (CONTEXT.md's own example: "..., 3, 3.5, 4"). That needs
-- a fractional type, not the integer this column started as.
alter table public.assessments alter column audit_number type numeric(5, 1);
alter table public.assessments alter column audit_number set default 1;
