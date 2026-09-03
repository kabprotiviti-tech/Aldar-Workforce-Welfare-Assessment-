-- The governance layer the RFP requires: an automated QA checklist, a
-- QA reviewer workflow (review mode, queries, pass/return), a client-
-- approval gate that locks the assessment and generates a report
-- version, and a formal revision mechanism that reopens a locked
-- assessment for version n+1 while leaving version n's report
-- untouched.
--
-- assessments.qa_completed_at/approved_at/issued_at and
-- assessment_items.locked were already scaffolded (0004_assessments.sql)
-- but never enforced or written to by any code — this migration is what
-- finally wires them up, plus the columns/tables that were still
-- missing (qa_status, approval_status, revision tracking, QA queries).

-- is_admin() already exists (0003_templates.sql).

-- qa_reviewer needs to write queries against a specific assessment
-- without the general can_write_operational() (admin/assessor) grant —
-- a distinct helper for that distinct permission, same shape as
-- is_staff()/can_write_operational() in 0002_core.sql.
create function public.can_qa_review() returns boolean
language sql stable
as $$
  select public.current_user_role() in ('admin', 'qa_reviewer');
$$;

-- QA status: not_started -> in_review -> (passed | back to in_review
-- after a query is raised and resolved). Distinct from `stage`
-- (0004_assessments.sql's eight-stage pipeline, whose own 'review' value
-- means desktop document review before an office visit — a different
-- thing this column is deliberately not reused for). See
-- docs/decisions.md.
alter table public.assessments add column qa_status text not null default 'not_started'
  check (qa_status in ('not_started', 'in_review', 'returned', 'passed'));

-- Approval: pending -> awaiting_client (set automatically the moment QA
-- passes — "on QA pass, the assessment moves to client approval," this
-- prompt) -> approved (the formal, admin-gated act of client approval,
-- which locks the assessment and generates a report). A revision resets
-- this back to 'pending'.
alter table public.assessments add column approval_status text not null default 'pending'
  check (approval_status in ('pending', 'awaiting_client', 'approved'));

-- n in "version n+1" (this prompt). Starts at 1 for every assessment;
-- incremented only by open_assessment_revision below, which is also the
-- only thing allowed to move approval_status backwards off 'approved'.
alter table public.assessments add column revision_number integer not null default 1;

-- A QA reviewer's query against one specific requirement (this prompt:
-- "raises queries against specific requirements"). Resolving one is an
-- assessor/admin action (can_write_operational — the same role that may
-- write the item itself), not a qa_reviewer one: the point of a query is
-- that someone else answers it.
create table public.qa_queries (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  assessment_item_id uuid not null references public.assessment_items (id) on delete cascade,
  query_text text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  raised_by uuid not null references auth.users (id),
  raised_at timestamptz not null default now(),
  resolution_note text,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qa_queries enable row level security;

create policy "qa_queries_select_staff" on public.qa_queries
  for select to authenticated using (public.is_staff());

create policy "qa_queries_insert_qa_reviewer" on public.qa_queries
  for insert to authenticated with check (public.can_qa_review());

create policy "qa_queries_update_staff" on public.qa_queries
  for update to authenticated using (public.is_staff());

-- One row per formal revision (this prompt: "creates version n+1,
-- preserving version n in full"). preserved_report_id anchors exactly
-- which report row was version n at the moment the revision opened —
-- that row is never touched again (see the reports immutability trigger
-- below), so "preserving version n in full" is a database guarantee,
-- not a filing convention.
create table public.assessment_revisions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  revision_number integer not null,
  reason text not null,
  preserved_report_id uuid not null references public.reports (id),
  revised_by uuid not null references auth.users (id),
  revised_at timestamptz not null default now(),
  unique (assessment_id, revision_number)
);

alter table public.assessment_revisions enable row level security;

create policy "assessment_revisions_select_staff" on public.assessment_revisions
  for select to authenticated using (public.is_staff());

-- No insert policy for `authenticated`: revisions are opened exclusively
-- through open_assessment_revision below (security definer), the same
-- reasoning as resolve_extracted_fact in 0021_fact_ledger.sql — the
-- row's actor/timestamp must be the caller's real identity, not
-- anything a direct insert could spoof, and the unlock has to happen in
-- the same transaction as the row that records it.

-- The report's actual content, not just a pointer to a storage file —
-- this is what makes "a revision preserves... its data exactly" a fact
-- provable in the database itself, independent of Storage. See
-- docs/decisions.md.
alter table public.reports add column snapshot jsonb not null default '{}'::jsonb;

-- === Immutability guarantees, at the trigger level (RLS can't provide
-- === them: the service-role/table-owner connection this app's own
-- === server code runs under bypasses RLS by design — the same
-- === reasoning as 0024_assessment_decision.sql and
-- === 0029_finding_lifecycle.sql). ===

-- A locked assessment item is immutable, full stop, in either
-- direction: once locked, no field may change except the explicit
-- unlock (locked: true -> false, nothing else in the same statement —
-- open_assessment_revision below is the only caller of that shape); and
-- it may only become locked in the first place once its parent
-- assessment is actually approved, closing the gap a direct write could
-- otherwise open.
create function public.enforce_assessment_item_lock() returns trigger
language plpgsql
as $$
declare
  v_parent_approved boolean;
begin
  if old.locked then
    if new.locked is distinct from false
       or (to_jsonb(new) - 'locked' - 'updated_at') is distinct from (to_jsonb(old) - 'locked' - 'updated_at')
    then
      raise exception 'A locked assessment item cannot be edited — open a formal revision first.';
    end if;
  elsif new.locked then
    select (approval_status = 'approved') into v_parent_approved from public.assessments where id = new.assessment_id;
    if not coalesce(v_parent_approved, false) then
      raise exception 'An assessment item can only be locked once its assessment has been approved.';
    end if;
  end if;
  return new;
end;
$$;

create trigger assessment_items_locked_immutable
  before update on public.assessment_items
  for each row execute function public.enforce_assessment_item_lock();

-- An approved assessment is immutable except for the one sanctioned
-- transition back out of it: open_assessment_revision resetting
-- approval_status to 'pending', qa_status to 'not_started',
-- approved_at/qa_completed_at to null, and revision_number to exactly
-- one more than it was — nothing else may change in that same
-- statement. Comparing whole rows as jsonb (minus the columns the
-- transition is allowed to touch) rather than hand-listing every
-- content column means this guarantee never silently goes stale as
-- future migrations add columns to assessments.
create function public.enforce_assessment_lock() returns trigger
language plpgsql
as $$
begin
  if old.approval_status = 'approved' then
    if not (
      new.approval_status = 'pending'
      and new.qa_status = 'not_started'
      and new.approved_at is null
      and new.qa_completed_at is null
      and new.revision_number = old.revision_number + 1
      and (to_jsonb(new) - 'approval_status' - 'qa_status' - 'approved_at' - 'qa_completed_at' - 'revision_number' - 'updated_at')
          is not distinct from
          (to_jsonb(old) - 'approval_status' - 'qa_status' - 'approved_at' - 'qa_completed_at' - 'revision_number' - 'updated_at')
    ) then
      raise exception 'An approved assessment is locked — open a formal revision first.';
    end if;
  end if;
  return new;
end;
$$;

create trigger assessments_locked_immutable
  before update on public.assessments
  for each row execute function public.enforce_assessment_lock();

-- "On QA pass, the assessment moves to client approval" (this prompt) —
-- an automatic database-level consequence of qa_status becoming
-- 'passed', not a second manual step someone could forget. Blocks the
-- pass itself while a query is still open. Reopening QA (moving off
-- 'passed') before the assessment has actually been approved reverts
-- approval_status to 'pending' — client approval is no longer waiting
-- on a QA pass that no longer holds.
create function public.enforce_qa_status_transition() returns trigger
language plpgsql
as $$
begin
  if new.qa_status is distinct from old.qa_status then
    if new.qa_status = 'passed' then
      if exists (select 1 from public.qa_queries where assessment_id = new.id and status = 'open') then
        raise exception 'An assessment cannot pass QA with an open query outstanding.';
      end if;
      new.qa_completed_at := now();
      new.approval_status := 'awaiting_client';
    elsif old.qa_status = 'passed' and old.approval_status = 'awaiting_client' then
      new.approval_status := 'pending';
      new.qa_completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger assessments_qa_status_transition
  before update on public.assessments
  for each row execute function public.enforce_qa_status_transition();

-- "On client approval..." — approval is only reachable once QA has
-- actually put the assessment in 'awaiting_client', never directly from
-- 'pending'. This is the database-level half of "on QA pass, the
-- assessment moves to client approval" — approval cannot happen any
-- other way, regardless of which application code path attempts it.
create function public.enforce_approval_transition() returns trigger
language plpgsql
as $$
begin
  if new.approval_status is distinct from old.approval_status and new.approval_status = 'approved' then
    if old.approval_status is distinct from 'awaiting_client' then
      raise exception 'An assessment can only be approved once QA has passed.';
    end if;
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end;
$$;

create trigger assessments_approval_transition
  before update on public.assessments
  for each row execute function public.enforce_approval_transition();

-- A generated report is immutable except for the is_current pointer
-- flipping when a newer version supersedes it — "preserves the earlier
-- report file and its data exactly" (this prompt's acceptance
-- criterion), enforced structurally rather than by application
-- discipline alone.
create function public.enforce_report_immutability() returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current') then
    raise exception 'A generated report cannot be edited — only is_current may change.';
  end if;
  return new;
end;
$$;

create trigger reports_immutable_except_is_current
  before update on public.reports
  for each row execute function public.enforce_report_immutability();

-- === The two governance actions that touch more than one table, done
-- === atomically (a Supabase/PostgREST client can't span a transaction
-- === across separate calls — the same reasoning as
-- === resolve_extracted_fact in 0021_fact_ledger.sql). ===

-- Client approval: locks every item, generates the report row (the
-- caller has already rendered p_snapshot and uploaded it to Storage at
-- p_storage_path — this function is the atomic database side of that,
-- not the render itself). security definer because it writes across
-- assessments/assessment_items/reports as one actor-checked unit; the
-- role check replaces the RLS that would otherwise run under the
-- caller's own session.
create function public.approve_assessment_and_generate_report(
  p_assessment_id uuid,
  p_storage_path text,
  p_snapshot jsonb,
  p_format text default 'json'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision integer;
  v_actor uuid := auth.uid();
  v_report_id uuid;
begin
  if not public.is_admin() then
    raise exception 'approve_assessment_and_generate_report: only an admin may approve an assessment';
  end if;

  select revision_number into v_revision from public.assessments where id = p_assessment_id for update;
  if v_revision is null then
    raise exception 'approve_assessment_and_generate_report: no assessment %', p_assessment_id;
  end if;

  -- issued_at (0004_assessments.sql) was scaffolded for exactly this
  -- moment — nothing before this feature ever wrote it. It's what
  -- 0007_findings_reports.sql's assessment_is_issued() and the
  -- client_viewer RLS policies on assessments/reports/findings have
  -- been gating on since they were written; client approval is the
  -- first real event that satisfies them. Left untouched by a later
  -- revision — the client keeps seeing the last approved report while
  -- one is in progress, not a gap where they suddenly see nothing.
  update public.assessments set approval_status = 'approved', issued_at = coalesce(issued_at, now()) where id = p_assessment_id;
  -- enforce_approval_transition raises here if approval_status wasn't
  -- 'awaiting_client' — nothing further below runs in that case.

  update public.assessment_items set locked = true where assessment_id = p_assessment_id;

  update public.reports set is_current = false where assessment_id = p_assessment_id and is_current;

  insert into public.reports (assessment_id, version, format, storage_path, snapshot, generated_by, is_current)
  values (p_assessment_id, v_revision, p_format, p_storage_path, p_snapshot, v_actor, true)
  returning id into v_report_id;

  return v_report_id;
end;
$$;

grant execute on function public.approve_assessment_and_generate_report(uuid, text, jsonb, text) to authenticated;

-- Opening a formal revision: reopens a locked assessment for version
-- n+1, unlocking every item, and records exactly which report row was
-- version n before doing so. admin-only ("a formal revision" — this
-- prompt's own word choice for the weight of the action).
create function public.open_assessment_revision(
  p_assessment_id uuid,
  p_reason text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_current_report_id uuid;
  v_next_revision integer;
begin
  if not public.is_admin() then
    raise exception 'open_assessment_revision: only an admin may open a formal revision';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'open_assessment_revision: a revision needs a reason';
  end if;

  if not exists (select 1 from public.assessments where id = p_assessment_id and approval_status = 'approved') then
    raise exception 'open_assessment_revision: assessment % is not approved', p_assessment_id;
  end if;

  select id into v_current_report_id from public.reports where assessment_id = p_assessment_id and is_current for update;
  if v_current_report_id is null then
    raise exception 'open_assessment_revision: no current report to preserve for assessment %', p_assessment_id;
  end if;

  update public.assessments
  set approval_status = 'pending',
      qa_status = 'not_started',
      approved_at = null,
      qa_completed_at = null,
      revision_number = revision_number + 1
  where id = p_assessment_id
  returning revision_number into v_next_revision;

  update public.assessment_items set locked = false where assessment_id = p_assessment_id;

  insert into public.assessment_revisions (assessment_id, revision_number, reason, preserved_report_id, revised_by)
  values (p_assessment_id, v_next_revision, btrim(p_reason), v_current_report_id, v_actor);

  return v_next_revision;
end;
$$;

grant execute on function public.open_assessment_revision(uuid, text) to authenticated;

grant select, insert, update on public.qa_queries to authenticated;
grant select on public.assessment_revisions to authenticated;
