# Schema

Source of truth is `supabase/migrations/`, applied in filename order. This file
is a scaffold — one section per table, kept short — updated in the same
commit as any migration that adds, drops, or changes a table, per the
convention in CONTEXT.md. Generated TypeScript types and Zod schemas for
every table live in `lib/db/`, grouped into files matching the migration
groups below.

RLS is enabled on every table. Two role groups recur throughout:
`is_staff()` (admin, assessor, qa_reviewer — full read across the supply
chain) and `client_viewer`, whose access is narrow and explicit per table
rather than blanket, matching CONTEXT.md's own description of that role:
"sees approved reports and open findings for their own entities only."
Helper functions (`current_user_role()`, `current_user_entity_id()`,
`is_staff()`, `can_write_operational()`, `is_admin()`,
`assessment_entity_id()`, `assessment_is_issued()`) are defined once in
`0002_core.sql`/`0007_findings_reports.sql` and reused by policies in every
migration after that. **A GRANT is not a policy** — `0008_grants.sql` gives
`authenticated` the table-level privilege every policy below assumes; RLS
restricts rows on top of a grant, it never creates one, and this migration
exists because that distinction caused a real bug during development (see
docs/decisions.md).

`0009_template_immutability.sql` enforces, with triggers rather than
convention, that a `checklist_templates` row and its `requirements`/
`questions` freeze the moment any `assessments` row references that
template — no update, delete, or new sibling row, for any Postgres role
including a superuser, with one exception (`is_active`, so a version can
still be retired). `0010_seed_checklist_templates_v1.sql` seeds version 1
for every module with real content; `0011_assessment_items_quantitative.sql`
adds the column the Accommodation template's mandatory quantitative
capture actually lives on.

## Core

### organisations
The consultancy's own tenant boundary for staff accounts — which
organisation a user (`users.organisation_id`) belongs to. Not the assessed
companies; those are `entities`.

### users (0001_init.sql, extended in 0002_core.sql)
Extends `auth.users` with `full_name`, `role`, `organisation_id`, `active`,
and (added here) `entity_id` — the one addition this prompt's schema needed
that wasn't in the original request: a client_viewer has to be scoped to
*something*, and the brief's "own entity_id" phrasing implies a direct
link, not a transitive one through an organisation. Null for every other
role.

### entities
The supply-chain companies actually being assessed — general contractors,
facilities management companies, asset operators, subcontractors. The
subject of every assessment, finding, and report.

`0015_evidence_files_rfi_and_nda.sql` adds `nda_required`/
`nda_confirmed_at`/`nda_confirmed_by`: if set, staff must confirm a
non-disclosure agreement is in place (once, for the entity — not
per-viewer) before that entity's evidence can be opened
(`components/app/nda-gate.tsx`).

### entity_contacts
Who to reach at an entity (name, role, email, phone), with one contact
flaggable as primary. Exists because assessments and evidence requests
need a named recipient, not just a company name.

### facilities
Physical sites belonging to an entity, inspected under the Accommodation
module. Separate from `entities` because one entity (e.g. a facilities
management company) can operate many facilities, each assessed on its own
schedule against its own regulatory threshold (capacity-dependent, per
CONTEXT.md).

### cycles
The yearly assessment period every assessment belongs to (e.g. "2026 Cycle
1"). Exists so "this cycle's" vs. "last cycle's" comparisons — carry-forward
requirements, recurrence detection — have something concrete to compare
against.

### public_holidays (0013_public_holidays.sql)
The UAE public holiday calendar `lib/scheduling/working-days.ts` reads to
compute `assessments.report_due_date`. Seeded with only the fixed-Gregorian-
date holidays (New Year's Day, Commemoration Day, National Day); the
Islamic-calendar ones are set by moon sighting and announced close to the
date, so they're added by an admin in Settings once confirmed each year
rather than guessed here. Admin-write, staff-read, like
`checklist_templates`.

## Templates
Versioned checklists. A report has to stay reproducible against the exact
template version it was assessed under (CONTEXT.md), so once any
assessment references a template, that template and its requirements/
questions are frozen — enforced by a trigger
(`0009_template_immutability.sql`), not just team practice: no update,
delete, or new row underneath an in-use template, for any role, with one
exception (`is_active`, so a version can still be retired). New content
ships as a new version instead.

### checklist_templates
One row per module per version (`employment_practices` / `onboarding` /
`accommodation`), with `is_active` marking the current one.
`0010_seed_checklist_templates_v1.sql` seeds version 1 for all three.

### requirements
A template's numbered requirements. For Employment Practices/Onboarding
these are literally "requirements" — the same 23, shared verbatim but
inserted as two separate rows-per-template since a template belongs to
exactly one module (`0010_seed_checklist_templates_v1.sql`), 10 of them
`is_key`. For Accommodation, the same table holds its 12 assessment areas
— one table, two names depending on module, rather than two
near-identical tables. `detail_text` (the EP/Onboarding sub-clause text an
assessor needs to see) is seeded `null` — real policy content pending
from the client, not invented to fill the column.

### questions
The per-requirement questions an assessor answers during an office
visit/document review, feeding `assessment_answers`. No rows yet for the
Accommodation template's 12 areas — its numbered key questions are real
regulatory content pending from the client, same reasoning as
`detail_text` above.

## Assessments
One row per entity (or facility) per cycle per module, and its
per-requirement/per-question content.

### assessments
The assessment record itself: which entity/facility, which cycle, which
template version, its subject code (the report header's `Subject` field),
what stage of the eight-stage lifecycle it's in, and the report-level
figures (`risk_rating`, `overall_compliance_pct`,
`adjusted_compliance_pct`) that `lib/rules/aggregate.ts` computes. A
client_viewer sees a row here only once `issued_at` is set — a draft
assessment is never visible to the client it's about.

`0012_visit_schedule.sql` adds the visit-scheduling columns this prompt's
entity/assessment management needed: `proposed_visit_date` (renamed from
`planned_visit_date`) and `confirmed_visit_date` sit alongside the
pre-existing `actual_visit_date` — three different, genuinely distinct
dates (an initial offer, an agreed date, and what actually happened).
`permission_required` is the assessment's own copy of a facility's
`access_permission_required` flag, taken at generation time
(`lib/scheduling/generate-cycle.ts`) and editable independently after —
see docs/decisions.md. The client's supporting access letter for a
permission-required visit is stored as any other evidence file
(`evidence_files.document_class = 'access_letter'`), not a dedicated
column. `audit_number` widened from integer to `numeric(5,1)`: full audits
are whole numbers, a follow-up is the whole number below it plus `.5`
(`lib/scheduling/subject-code.ts`).

### assessment_items
One row per requirement within one assessment — the compliance status,
remark, and action required for closure that `lib/rules/validation.ts`
checks. `carried_forward_from_item_id` links a requirement not reassessed
this cycle back to the item it inherited its rating from. `quantitative`
(`0011_assessment_items_quantitative.sql`) holds the Accommodation
template's mandatory per-area fields (location, capacity, occupancy, area
per resident, etc.) — captured regardless of the area's Yes/No/Unclear/
Not Applicable answer, so it lives on the item, not on one question's
answer. Shape validated by the per-area schemas in
`lib/db/accommodation-quantitative.ts`.

### assessment_answers
One row per question within one assessment item, for the modules that
work question-by-question (Employment Practices/Onboarding). Rolls up
into its parent item's compliance status; a request the assessor confirms
never touches this table without also touching the item above it.

## Evidence and AI
Staff-only throughout — CONTEXT.md scopes client_viewer to "reports and
findings," not the working material behind them. `extractions` and
`extracted_facts` and `ai_observations` are exactly "what CONTEXT.md rule
2/3 says a model is allowed to produce": structured values and
observations, never a status, never arithmetic.

### evidence_files
An uploaded document (payslip, contract, drawing, photo) tied to one
assessment, with a review workflow (`review_status`) separate from
whatever the model made of it.

`0015_evidence_files_rfi_and_nda.sql` adds `requirement_id` (which
requirement this file evidences, when known) and `rfi_checklist_item_id`
(which RFI checklist line it satisfies, when uploaded through the portal
— `lib/rfi/portal.ts`). `uploaded_by` is now nullable and
`uploaded_by_contact_id` added alongside it, exactly one of the two set:
a staff upload still records `uploaded_by` (a Supabase user); an RFI
portal upload has no Supabase session at all and records
`uploaded_by_contact_id` (the RFI's own `entity_contacts` row) instead —
never anything the uploader could self-report, since it's copied from the
RFI request server-side. `virus_scan_status`/`virus_scanned_at` are the
virus-scan hook's result (`lib/rfi/virus-scan.ts` — a stub today, swappable
for a real scanner).

### extractions
One run of the model against one evidence file — what it returned, which
prompt version, token/cost accounting. Immutable once written: a
correction doesn't edit an extraction, a human resolving a fact does
(`extracted_facts.resolved_*`).

### extracted_facts
One proposed value from an extraction, and the human decision on it
(`proposed` → `accepted`/`edited`/`rejected`). This is CONTEXT.md rule 4 as
a table: nothing here reaches a report without `resolved_by`/`resolved_at`
being set by a person.

### ai_observations
Something the model flagged for a human to look at (a gap, something worth
attention) — never a compliance status, always routed to
`confirmed`/`rejected`/`noted` by a person (`actioned_by`).

## Rules and measurement

### rule_definitions
The rule engine's reference data: which requirement a rule checks, which
extracted-fact keys it needs, its threshold, its legal basis. Content
authored by admins, the same way templates are.

### rule_evaluations
One run of the rule engine against one assessment item — its inputs, its
result (`pass`/`fail`/`insufficient_data`), and a human-readable
explanation of how it got there. Append-only, like `extractions`: a
re-evaluation is a new row.

### rooms
Room-level measurements for an accommodation facility.
`computed_m2_per_person` is a **generated column** — the database computes
it from `measured_area_m2` (or `drawing_area_m2`) and `occupancy_count`,
the same way every time, because CONTEXT.md rule 2 ("the model never
performs arithmetic ... a typed rule engine evaluates") applies just as
much to a human typing numbers into a form as it does to a model.

### photos
Site photos tied to an assessment and (optionally) a specific
requirement/area, with geolocation and an optional link to the extraction
that analysed it (`analysis_id`).

## Findings and reports
The two things CONTEXT.md says a client_viewer may see.

### findings
An open item raised against one assessment item: priority, owner, due
date, a five-stage status (`open` → `in_progress` → `evidence_submitted` →
`under_review` → `closed`), and — for recurrence tracking —
`repeat_of_finding_id`. A client_viewer sees findings for their own entity
with `status <> 'closed'` ("open findings," read as "not yet closed" —
see docs/decisions.md).

### finding_events
The internal history behind a finding (status changes, comments,
escalations). Staff-only — this is the working trail, not the finding
itself.

### reports
A generated report file for an assessment: version, format, storage path,
and `is_current` marking which version is the live one. A client_viewer
sees a report only when it's `is_current` and its assessment has been
issued — "approved reports," not drafts or superseded versions.

## Request for information (RFI)
`0014_rfi.sql`. The tokenised-portal tables have no RLS policies at all —
they're written and read exclusively by server code holding the
service-role client (`lib/rfi/portal-supabase.ts`), since a portal
visitor has no Supabase session to apply RLS to in the first place. See
docs/decisions.md.

### rfi_document_templates
A requestable document type for one module (e.g. "Payroll register" for
Employment Practices), admin-authored like `checklist_templates`.

### rfi_document_template_requirements
Many-to-many: which requirement(s) a document template evidences.

### rfi_requests
One RFI issued for one assessment, to one `entity_contacts` row, with a
due date (default 14 calendar days from issue) and a status
(`open`/`completed`/`expired`/`cancelled`) — `completed` is set
automatically once every checklist line is `received`
(`lib/rfi/portal.ts`).

### rfi_checklist_items
One row per (document template, requirement it evidences) pair requested
in one RFI — `name`/`requirement_id` are a snapshot at issue time, so
editing a template later never rewrites an RFI already sent.
`status`: `outstanding` → `received` (or `waived`).

### rfi_tokens
The portal link's access credential. Only `token_hash` (SHA-256 of the
raw token) is stored — the raw value exists only in the emailed link,
never at rest (`lib/rfi/token.ts`). `expires_at`/`revoked_at` are the two
ways a token stops working.

### rfi_token_access_log
Every attempt to use a portal token, valid or not — the "and is logged"
half of this prompt's 403 acceptance criterion, and the data rate
limiting reads from. Not `public.audit_log`: these attempts have no
`actor_id` (no signed-in user exists) and need a fast, token-scoped
lookup audit_log isn't shaped for.

### rfi_reminders_sent
Dedupe ledger for the reminder schedule (due date minus 3 days, on the
due date, once overdue) — `unique(rfi_request_id, kind)` is what actually
prevents a double-send, not application logic alone
(`lib/rfi/send-reminders.ts`).
