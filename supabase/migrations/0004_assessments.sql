-- Assessments: one row per entity/facility per cycle per module, its
-- per-requirement items, and (for Employment Practices/Onboarding) the
-- underlying per-question answers that roll up into an item's status.
--
-- compliance_status and answer reuse the exact fixed-vocabulary casing
-- from lib/rules/constants.ts (COMPLIANCE_RATINGS, QUESTION_ANSWERS) and
-- risk_rating reuses RISK_RATINGS — the same values, enforced in two
-- places (Zod at the app boundary, a check constraint at the database
-- boundary) rather than one.

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('employment_practices', 'onboarding', 'accommodation')),
  cycle_id uuid not null references public.cycles (id),
  entity_id uuid not null references public.entities (id),
  facility_id uuid references public.facilities (id),
  template_id uuid not null references public.checklist_templates (id),
  subject_code text not null unique,
  audit_number integer not null default 1,
  assessment_type text not null check (assessment_type in ('initial', 'follow_up')),
  stage text not null default 'plan'
    check (stage in ('plan', 'request', 'collect', 'review', 'assess', 'report', 'act', 'monitor')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'on_hold', 'completed', 'cancelled')),
  owner_id uuid references auth.users (id),
  previous_assessment_id uuid references public.assessments (id),
  planned_visit_date date,
  actual_visit_date date,
  report_due_date date,
  qa_completed_at timestamptz,
  approved_at timestamptz,
  issued_at timestamptz,
  risk_rating text check (risk_rating in ('Low', 'Medium', 'High')),
  overall_compliance_pct numeric,
  adjusted_compliance_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.assessments enable row level security;

create policy "assessments_select_staff" on public.assessments
  for select to authenticated using (public.is_staff());

-- A client_viewer sees only issued assessments for their own entity —
-- "approved reports", per CONTEXT.md's role description, not drafts.
create policy "assessments_select_client_viewer" on public.assessments
  for select to authenticated
  using (
    public.current_user_role() = 'client_viewer'
    and entity_id = public.current_user_entity_id()
    and issued_at is not null
  );

create policy "assessments_write_staff" on public.assessments
  for insert to authenticated with check (public.can_write_operational());

-- qa_reviewer needs UPDATE too (to set qa_completed_at/approved_at). RLS
-- is row-level, not column-level — restricting qa_reviewer to only those
-- two fields is an application-layer rule, not a database one.
create policy "assessments_update_staff" on public.assessments
  for update to authenticated using (public.is_staff());

create table public.assessment_items (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  requirement_id uuid not null references public.requirements (id),
  compliance_status text check (compliance_status in ('Compliant', 'Partial', 'Not Compliant', 'Not Applicable')),
  remarks text,
  action_required text,
  was_assessed boolean not null default true,
  carried_forward_from_item_id uuid references public.assessment_items (id),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (assessment_id, requirement_id)
);

alter table public.assessment_items enable row level security;

create policy "assessment_items_select_staff" on public.assessment_items
  for select to authenticated using (public.is_staff());

create policy "assessment_items_write_staff" on public.assessment_items
  for insert to authenticated with check (public.can_write_operational());

create policy "assessment_items_update_staff" on public.assessment_items
  for update to authenticated using (public.is_staff());

create table public.assessment_answers (
  id uuid primary key default gen_random_uuid(),
  assessment_item_id uuid not null references public.assessment_items (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  answer text check (answer in ('Yes', 'No', 'Unclear', 'Not Applicable')),
  remark text,
  action_required text,
  quantitative jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (assessment_item_id, question_id)
);

alter table public.assessment_answers enable row level security;

create policy "assessment_answers_select_staff" on public.assessment_answers
  for select to authenticated using (public.is_staff());

create policy "assessment_answers_write_staff" on public.assessment_answers
  for insert to authenticated with check (public.can_write_operational());

create policy "assessment_answers_update_staff" on public.assessment_answers
  for update to authenticated using (public.is_staff());
