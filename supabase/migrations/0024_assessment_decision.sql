-- The screen where the assessment is actually made (this prompt). Three
-- things the schema needed: somewhere to autosave an assessor's drafting,
-- somewhere to record interview insights that never reach the entity, and
-- a guarantee that a compliance status can only ever be written by an
-- authenticated assessor.

-- ---------------------------------------------------------------------------
-- Drafting and specific detail capture
-- ---------------------------------------------------------------------------

-- "Assessor observations (free text, autosaved draft)" and "office visit
-- observations" (this prompt). Autosaved server-side rather than into
-- browser storage: a draft has to survive a refresh, a crashed tab, and a
-- different device — an assessor who typed four paragraphs on site should
-- not lose them to a browser. draft_updated_at is what the UI shows as
-- "saved a moment ago".
alter table public.assessment_items add column assessor_observations text;
alter table public.assessment_items add column office_visit_observations text;
alter table public.assessment_items add column draft_updated_at timestamptz;

-- "The report must contain numbers, not adjectives" (this prompt): salary
-- transfer dates, deduction examples, sample sizes evidenced. Structured
-- jsonb validated at the app boundary by evidenceDetailSchema
-- (lib/assessment/detail.ts) rather than a column per kind — the shapes
-- differ per requirement and will grow, and the alternative is a wide
-- table of mostly-null columns.
alter table public.assessment_items add column evidence_detail jsonb;

-- ---------------------------------------------------------------------------
-- Interview insights — staff-only, never entity-visible
-- ---------------------------------------------------------------------------

-- "Interview notes are stored separately and are never included in the
-- entity-visible report" (this prompt). Separately means a separate
-- table, not a column with a convention attached: a client_viewer has no
-- select policy here at all, so the strongest read path they have —
-- their own session — returns nothing, and the report builder has to opt
-- in by joining a table it has no reason to touch.
create table public.interview_insights (
  id uuid primary key default gen_random_uuid(),
  assessment_item_id uuid not null references public.assessment_items (id) on delete cascade,
  workers_interviewed_count integer check (workers_interviewed_count >= 0),
  nationalities text[] not null default '{}',
  interpreter_used boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (assessment_item_id)
);

alter table public.interview_insights enable row level security;

-- Staff only, in both directions. There is deliberately no client_viewer
-- policy: workers spoke to an assessor in confidence, and the entity
-- being assessed is the party they may most need protection from.
create policy "interview_insights_select_staff" on public.interview_insights
  for select to authenticated using (public.is_staff());

create policy "interview_insights_insert_staff" on public.interview_insights
  for insert to authenticated with check (public.can_write_operational());

create policy "interview_insights_update_staff" on public.interview_insights
  for update to authenticated using (public.can_write_operational());

grant select, insert, update on public.interview_insights to authenticated;

-- ---------------------------------------------------------------------------
-- A compliance status can only be written by an authenticated assessor
-- ---------------------------------------------------------------------------

-- This prompt's acceptance criterion: "A status cannot be written by any
-- code path other than an authenticated assessor action. Prove it with a
-- test that attempts a service-level write and fails."
--
-- RLS alone cannot deliver that. The service-role client bypasses RLS by
-- design (lib/supabase/admin.ts), and so does the table owner — so an
-- RLS policy would be a promise that the app's own privileged code path
-- could break at any time. A trigger binds every writer equally: it fires
-- for the service role, for a superuser running psql, and for a future
-- background job, none of which have an auth.uid().
--
-- It also does the two things this prompt requires of a status write, so
-- neither depends on a caller remembering: decided_by/decided_at are
-- stamped from the authenticated actor, and the audit_log row is written
-- in the same transaction as the decision.
create function public.enforce_assessor_status_decision() returns trigger
language plpgsql
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.compliance_status is not distinct from old.compliance_status then
    -- Not a status change: drafting, detail capture, carry-forward
    -- housekeeping. Nothing to enforce or stamp.
    return new;
  end if;

  if v_actor is null then
    raise exception 'assessment_items.compliance_status can only be set by an authenticated assessor; this write has no authenticated actor'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.can_write_operational() then
    raise exception 'assessment_items.compliance_status can only be set by an admin or assessor'
      using errcode = 'insufficient_privilege';
  end if;

  -- Stamped here, not by the caller: "saving a status writes decided_by
  -- and decided_at" is then true of every code path that ever sets one.
  new.decided_by := v_actor;
  new.decided_at := now();
  new.updated_at := now();

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    v_actor,
    'assessment_item.decide',
    'assessment_item',
    new.id::text,
    jsonb_build_object('compliance_status', old.compliance_status, 'remarks', old.remarks, 'action_required', old.action_required),
    jsonb_build_object('compliance_status', new.compliance_status, 'remarks', new.remarks, 'action_required', new.action_required)
  );

  return new;
end;
$$;

create trigger assessment_items_status_requires_assessor
  before update on public.assessment_items
  for each row execute function public.enforce_assessor_status_decision();

-- The same guarantee on the way in: a row cannot be *created* carrying a
-- status either, which would otherwise be a way around the update trigger.
create function public.enforce_assessor_status_on_insert() returns trigger
language plpgsql
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.compliance_status is null then
    return new;
  end if;

  if v_actor is null or not public.can_write_operational() then
    raise exception 'assessment_items cannot be created with a compliance_status by this actor; an assessor decides a status after the item exists'
      using errcode = 'insufficient_privilege';
  end if;

  new.decided_by := v_actor;
  new.decided_at := now();

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (v_actor, 'assessment_item.decide', 'assessment_item', new.id::text, null,
          jsonb_build_object('compliance_status', new.compliance_status, 'remarks', new.remarks, 'action_required', new.action_required));

  return new;
end;
$$;

create trigger assessment_items_insert_status_requires_assessor
  before insert on public.assessment_items
  for each row execute function public.enforce_assessor_status_on_insert();
