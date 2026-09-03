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

### assessment_items (0024_assessment_decision.sql)
`assessor_observations`, `office_visit_observations` and
`draft_updated_at` hold the assessor's drafting, autosaved server-side —
a draft has to survive a refresh, a crashed tab and a different device,
which browser storage does not. `evidence_detail` is the structured
"numbers, not adjectives" capture (salary transfer dates, deduction
examples, sample sizes), validated by `evidenceDetailSchema`
(`lib/assessment/decision.ts`).

**A compliance_status can only be written by an authenticated assessor**,
enforced by the `assessment_items_status_requires_assessor` and
`assessment_items_insert_status_requires_assessor` triggers rather than
by RLS. RLS could not deliver it: the service-role client and the table
owner both bypass row-level security by design, so a policy would be a
promise the app's own privileged code could break. The triggers bind
every writer equally — service role, superuser, future background job —
and they also stamp `decided_by`/`decided_at` and write the `audit_log`
row in the same transaction, so neither depends on a caller remembering.
They fire only on a status change, so drafting and detail capture are
unaffected.

### assessment_items (0028_carry_forward.sql)
`previous_compliance_status`/`previous_remarks`/`previous_action_required`
are a snapshot of the requirement's rating on the assessment
`carried_forward_from_item_id` points at — written when the item is
generated, alongside `was_assessed = false`. They exist as their own
columns, separate from `compliance_status`/`remarks`/`action_required`,
because those live columns can only ever be written by an authenticated
assessor deciding a status (the trigger immediately above): populating
them straight from last cycle's value at generation time would either
need an actor who decided nothing, or misrepresent an inherited value as
a fresh decision. The live columns are always set afterwards by an
explicit assessor action — a genuine reassessment, or the "not assessed
this cycle" confirmation (`lib/assessment/actions.ts`'s
`markNotAssessedThisCycle`), which is itself a real decision even though
the value it writes happens to equal last cycle's. See docs/decisions.md.

### interview_insights (0024_assessment_decision.sql)
Workers interviewed, nationalities, whether an interpreter was used, and
notes — one row per assessment item. A separate table rather than
columns, because "never included in the entity-visible report" needs to
be structural: there is deliberately **no client_viewer select policy**,
so the strongest read path a client has returns nothing, and a report
builder has to join a table it has no reason to touch. Workers spoke to
an assessor in confidence, and the entity being assessed is the party
they may most need protection from.

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

`0017_evidence_review_and_requirements.sql` widens `review_status` to
five values (`outstanding`/`received`/`in_review`/`reviewed`/
`gap_flagged`, replacing `pending`/`reviewed`) and adds
`evidence_file_requirements`. `document_class` stays free text at the
database layer — two administrative sentinel values (`access_letter`,
`rfi_upload`) already use the column outside the 14-value business
vocabulary `lib/evidence/classify.ts` proposes from, so the fixed
vocabulary is enforced with a Zod schema (`documentClassSchema`,
`lib/db/evidence.ts`) at the app boundary instead of a `check`
constraint. See docs/decisions.md.

### evidence_file_requirements
Many-to-many, assessor-editable: which requirement(s) one evidence file
counts as evidence for (this prompt: "link a file to one or more
requirements"). Coverage (`lib/evidence/coverage.ts`) is computed from
this table, scoped to one assessment's own requirements — not from
`evidence_files.requirement_id`, which is a different, narrower thing:
the one requirement an RFI checklist line was issued for, set once at
upload time and never edited.

### extractions
One run of the model against one evidence file — what it returned, which
prompt version, token/cost accounting. Immutable once written: a
correction doesn't edit an extraction, a human resolving a fact does
(`extracted_facts.resolved_*`). `error` holds a human-readable reason
(malformed JSON, a forbidden field, an API failure) when the call didn't
produce usable facts — the "extraction failed, review manually" case
(`lib/ai/extract.ts`).

### extracted_facts
One proposed value from an extraction, and the human decision on it
(`proposed` → `accepted`/`edited`/`rejected`). This is CONTEXT.md rule 4 as
a table: nothing here reaches a report without `resolved_by`/`resolved_at`
being set by a person.

`0018_extracted_facts_shape.sql` widens this table to the document
extraction service's fact shape (this prompt): `confidence` becomes the
fixed `high`/`medium`/`low` vocabulary (was `numeric`, from before that
vocabulary existed); `verbatim_quote` and `reason`
(`not_present`/`illegible`, set exactly when the model found no value)
are added; `value_boolean` and `value_json` extend the existing
typed-column-per-shape pattern (`0005_evidence_ai.sql`) alongside
`value_text`/`value_number`/`value_date` — `value_json` is the one shape
those four don't cover (list-valued facts like
`payroll_deduction_types`). Exactly one `value_*` column (or none, with
`reason` set) is populated per row; which one is a pure function of the
model's returned value type (`factToInsert`, `lib/ai/extract.ts`).

`0021_fact_ledger.sql` adds `rejection_reason` (an assessor's reason for
refusing a fact — distinct from `reason`, which is the *model* explaining
an absence) and `bbox` (an optional normalized 0-1 region of the page the
fact was read from, so the preview can highlight it; null today because
the v1 prompts don't ask the model for coordinates — see
docs/decisions.md). An edited fact keeps the model's `value_*` columns
untouched as provenance and stores the human's value in
`resolved_value_json` as `{"value": ...}`.

`0027_room_area.sql` adds `group_ref`: which entry (a room on a drawing,
a row on an occupancy schedule) one fact is about, for a document that
lists many of the same kind of thing. Set once, at extraction time, to
that entry's own printed label (`lib/ai/prompts/approved_drawing/v2.ts`,
`lib/ai/prompts/occupancy_schedule/v2.ts`) — an assessor's later edit to
the fact's *value* never touches it, which is what keeps grouping
correct after facts about the same room are accepted, edited or
rejected individually and out of order (`lib/rooms/group-facts.ts`).
Null (the default for every fact key that existed before this feature)
means "this fact is about the whole document".

### fact_ledger_confirmed (view)
`0021_fact_ledger.sql`. **The only read path for facts.** Nothing
downstream — rules, findings, reports, dashboards — reads
`extracted_facts` directly; a test enforces that
(`tests/read-path.test.ts`), and the view makes the mistake impossible
rather than merely discouraged:

- It returns only `accepted` and `edited` rows, so a `proposed` value
  (never reviewed) or a `rejected` one (actively refused) is invisible.
- It exposes a single `confirmed_value` (jsonb) — an edited fact's human
  value, otherwise the accepted model value — and deliberately **omits**
  the raw `value_*` and `resolved_value_json` columns, so no consumer can
  read a superseded proposal by mistake or re-implement that precedence
  incorrectly.
- `security_invoker = true`, so it's subject to the caller's own RLS
  rather than the view owner's (Postgres's default for views would
  silently bypass the staff-only policies on the underlying tables).

`resolve_extracted_fact(fact_id, status, resolved_value, rejection_reason)`
is the matching write path: one `security definer` function that applies
the resolution **and** appends its `audit_log` row in a single
transaction, so a status change without an audit entry isn't reachable.
It checks `is_staff()` itself and is granted to `authenticated` so
`auth.uid()` is the real assessor (recorded as both `resolved_by` and the
audit actor).

### ai_observations
Something the model flagged for a human to look at (a gap, something worth
attention) — never a compliance status, always routed to
`confirmed`/`rejected`/`noted` by a person (`actioned_by`).

### ai_observations (0023_observations.sql)
The narrative layer between facts, rules and the assessor. The three
kinds were already right in 0005; this migration adds what source
referencing and validation need: `source_fact_keys`/`page_ref` (the
structured half of a source reference — an observation with none is
discarded before it is ever stored), `requirement_id` (set from the item,
never from the model), `rule_code`/`rule_evaluation_id` (the result whose
outcome *code* turned into the kind), `model`/`prompt_version`
provenance, `rejection_reason` (a rejected observation is retained, not
deleted), and `authored_by` (`model` or `assessor` — "Add observation"
makes an assessor a first-class author).

Note what the table still has no column for: a compliance status, a
rating or a score. `status` here is the review state
(`open`/`confirmed`/`rejected`/`noted`), and a test asserts the
distinction.

0008 granted only select/update to `authenticated` because every row used
to be model-written through the service-role client; 0023 adds `insert`
under `can_write_operational()` so an assessor can add their own.

### extraction_jobs
`0019_extraction_jobs.sql`. The document extraction batch queue (this
prompt: "a queue so a batch of 18 documents extracts in the background
with visible progress") — one row per evidence file in a batch,
`batch_id` grouping the rows one "Extract all" action created so progress
is a single count query (`lib/ai/queue.ts`'s `getBatchProgress`).
`status`: `queued` → `running` → `succeeded`/`failed`. Written and read
only by server code (`lib/ai/queue-supabase.ts`) — like
`extractions`/`extracted_facts`, nothing about queue mechanics needs an
authenticated user's own session; the `select` RLS policy exists only so
the batch-progress route can read it back through the caller's own
session. `0020_claim_extraction_job.sql` adds
`claim_next_extraction_job(batch_id)`, a `security definer` function
doing the claim-and-mark-running step (`FOR UPDATE SKIP LOCKED`) as one
atomic round trip, so two overlapping workers — the normal batch run and
the stuck-job sweep retrying it — never claim the same row. The
`(status, started_at)` index backs the sweep's query for jobs stuck
`running` past a threshold (`lib/ai/queue-supabase.ts`'s
`requeueStuckExtractionJobs`, `app/api/ai/sweep-stuck-jobs`).

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
Room-level measurements for an accommodation facility. Facility-scoped
rather than assessment-scoped — a room's area and occupancy persist
across cycles the same way the facility itself does.

`computed_m2_per_person` is a **generated column** — the database computes
it from `measured_area_m2` (or `drawing_area_m2`) and `occupancy_count`,
the same way every time, because CONTEXT.md rule 2 ("the model never
performs arithmetic ... a typed rule engine evaluates") applies just as
much to a human typing numbers into a form as it does to a model.
`0027_room_area.sql` rebuilds it (dropped and re-added — Postgres has no
ALTER for a stored generated column's expression) to require
`area_confirmed_at` and `occupancy_confirmed_at` both being set: this
prompt's own acceptance criterion, "no m² per person value can exist
without a confirmed area AND a confirmed occupancy", enforced as a
property of the column itself rather than of whoever reads it.

`area_confirmed_at`/`area_confirmed_by` and
`occupancy_confirmed_at`/`occupancy_confirmed_by` are the two
confirmation gates. `drawing_area_low_confidence` distinguishes "the
drawing never mentioned this room" from "it did, but the reading was
too unreliable to propose" — two different reasons the review screen
falls back to a manual field, the second one this prompt's own
"degrade honestly" instruction. `occupancy_source`
(`physical_count`/`schedule`) records which of the two permitted
sources `occupancy_count` currently is.
`schedule_occupancy_headcount` is the occupancy schedule's own
confirmed figure, kept independently of `occupancy_count` so a schedule
reading can be reconciled against a physical count
(`ACM_OCCUPANCY_RECONCILED`,
`lib/rules/compliance/rules/accommodation.ts`) without either
silently overwriting the other; it is informational until an assessor
promotes it via `confirm_room_occupancy_from_schedule`.

`resolve_room_area` confirms the proposed `drawing_area_m2` as-is, or
records an assessor's own measurement — either way stamping the
confirmation and setting `source` (`drawing`/`manual`/`both`, already
declared but unwired before this feature) so a report can state where
an area came from. `propose_room_measurements` is the only thing
allowed to write `drawing_area_m2`/`schedule_occupancy_headcount`: it
never overwrites an already-confirmed area, and always refreshes the
schedule figure, so a stale or since-rejected reading doesn't linger.
`apply_inspection_mutation`'s `room_count` branch stamps the occupancy
confirmation itself — an assessor's own physical count needs no further
review step.

### photos
Site photos tied to an assessment and (optionally) a specific
requirement/area, with geolocation and an optional link to the extraction
that analysed it (`analysis_id`).

### rule_definitions (0022_rule_engine.sql)
`version` makes a definition a *version* rather than a mutable row: an
admin edit supersedes with `version + 1` and deactivates the old one
(`lib/rules/compliance/actions.ts`), and a partial unique index allows
only one active version per `code`. A definition an evaluation already
points at is immutable except for `active`, enforced by the
`rule_definitions_immutable_once_used` trigger — the same reasoning as
0009's template immutability: a stored result must keep meaning what it
meant. `title`, `explanation_template` and `quantitative_keys` record the
rest of the rule's declared shape alongside `input_fact_keys` and
`threshold`.

Version 1 of all 13 v1 rules is seeded, with `requirement_id` resolved by
`(module, sl_no)` against the active template — the rule codes follow the
checklist's own numbering (`R11_WAGE_DATE` -> requirement 11, "Timely
wage payment"; `ACM_*` -> an Accommodation area). Seeded thresholds
duplicate the defaults declared in `lib/rules/compliance/rules/`, and
`tests/db/rule-engine.test.ts` fails if the two ever drift.

`0027_room_area.sql` seeds a 14th rule, `ACM_OCCUPANCY_RECONCILED`, as a
standalone insert rather than an edit to this migration — a migration
already applied is never rewritten, the same principle 0009's template
immutability applies to itself. It compares a room's on-site occupancy
count against the occupancy schedule and is not itself a statutory
ratio; see `lib/rules/compliance/rules/accommodation.ts`.

### rule_evaluations (0022_rule_engine.sql)
Stamped with everything needed to reproduce a result from the row alone:
`rule_definition_id` and `rule_version` (which version produced it),
`thresholds` and `legal_reference` (what it was computed against),
`observed` (the values the arithmetic ran on) alongside `inputs` (what was
available), and `missing_fact_keys` (which inputs were absent, for an
`insufficient_data` result). `subject_ref` distinguishes repeated runs of
one rule for one requirement — room "A-101", vehicle "AD-12345".

Evaluations are stored, never recomputed on read, so revising a threshold
cannot change what a past report said.

### inspection_sync_log (0025_inspection_sync.sql)
The idempotency ledger behind the offline inspection. Every queued
mutation carries a `client_mutation_id` generated on the phone at capture
time, and that id is this table's primary key — so a replay (a retry, a
resumed sync, a lost acknowledgement) inserts nothing and applies
nothing. A log table rather than a unique column per target table,
because the mutations aren't all inserts: a quantitative capture updates
a row that already exists and has no per-mutation row to constrain.

`apply_inspection_mutation(client_mutation_id, assessment_id, kind,
payload)` claims the id and does the work in one transaction, so there is
no window where a mutation is applied but unrecorded or recorded but
unapplied. It handles six kinds: `area_answer`, `area_quantitative`,
`certificate` (appended, not overwritten, so two captured offline both
survive), `area_rating` (which goes through 0024's assessor-decision
trigger like any other status write), `room_count` (the assessor's own
physical bed and occupancy count, recorded as a `manual` room source) and
`photo`.

`photos` gains `room_ref` — free text rather than an FK, because a photo
is often taken before the room row exists and a photo that can't be
saved on site is a photo lost.

## Findings and reports
The two things CONTEXT.md says a client_viewer may see.

### findings
An open item raised against one assessment item: priority, owner, due
date, a five-stage status (`open` → `in_progress` → `evidence_submitted` →
`under_review` → `closed`), and — for recurrence tracking —
`repeat_of_finding_id`. A client_viewer sees findings for their own entity
with `status <> 'closed'` ("open findings," read as "not yet closed" —
see docs/decisions.md).

Written automatically by `lib/assessment/actions.ts`'s `saveDecision`
whenever a fresh decision rates a requirement Partial or Not Compliant —
one finding per compliance area kept live at a time (a re-save of the
same failing decision does not spawn a duplicate). `repeat_of_finding_id`
is set when the most recent finding ever raised for this requirement,
for this entity, was formally closed: that search walks the entity's
whole history for the requirement, not just the immediately preceding
cycle, because a requirement can go fail → closed → compliant → fail
again, with the closed finding that makes the second failure a *repeat*
sitting further back than one hop. See docs/decisions.md.

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

## Photograph analysis
`0026_photo_analysis.sql`. Vision analysis of inspection photographs. The
constraint is the feature: a photograph is analysed for a closed list of
classes and fields, it produces observations rather than answers, and
nothing it reports reaches a rule until an assessor has confirmed it.

### photo_class_names
The eight classes a photograph may be analysed for — fire extinguisher,
exit route, notice board, certificate or document, accommodation room,
kitchen, ablution facilities, vehicle. A table rather than a check
constraint because two columns reference it (`photos.photo_class` and
`photo_analyses.photo_class`), and one source of truth beats two
constraints that drift. `lib/vision/classes.ts` declares the same list
alongside each class's fields; a drift test holds the two together.

### photos.photo_class
What the assessor says they photographed, captured on the phone at the
same moment as the image and carried through the offline queue by
`apply_inspection_mutation`. Nullable — a record shot is not analysed at
all, which is a legitimate thing to capture.

### photo_analyses
One analysis run over one photograph. `findings` is the reading list the
analyser kept after its guards ran; `raw_response` is what the model
actually returned, kept as provenance and read by nothing downstream;
`cannot_determine` is what this photograph cannot establish, part of the
analysis rather than a footnote; `suppressed` records what the guards
removed. `status` is `proposed` → `accepted`/`edited`/`rejected`, with a
check constraint making the rejection reason required on a rejection and
`edited_findings` required on an edit.

### photo_analysis_confirmed
The only read path for an analysis, the same shape and for the same
reason as `fact_ledger_confirmed`: a proposed analysis has never been
looked at and a rejected one was refused, and neither belongs near a
report. `confirmed_findings` resolves which version is authoritative, so
no consumer can read a superseded proposal by mistake. `security_invoker
= true`, so the caller's own RLS applies. `tests/read-path.test.ts`
proves no module reaches around it.

### extracted_facts, second source
`extraction_id`/`evidence_file_id` are now nullable and
`photo_analysis_id` is the alternative, with
`extracted_facts_one_source` requiring exactly one of the two.
`fact_ledger_confirmed` gains `photo_analysis_id`/`photo_id` and resolves
`assessment_id` from whichever source the fact came from — everything
else about the view, including that it exposes only `confirmed_value`,
is unchanged.

### photo_derived_fact_keys
The fixed list of fact keys a photograph may ever produce, mirrored in
code by `PHOTO_DERIVED_FACT_KEYS`. The
`extracted_facts_photo_derived_fact_key` trigger rejects any
photo-sourced fact whose key is not in it — which is where "a bedroom
photograph never yields an area or per-person value" stops being a code
convention and becomes something no code path can work around, service
role included.

### resolve_photo_analysis
Records the assessor's decision and, where they confirmed a printed
reading, creates the facts it becomes — one transaction, for the same
reason as `resolve_extracted_fact`. It refuses a rejection with no
reason, a rejection that also produces facts, a second decision on an
already-reviewed analysis, and a caller who is not staff. Derived facts
are written at `accepted` with the assessor as `resolved_by`: they have
just confirmed the reading against the photograph in front of them.
