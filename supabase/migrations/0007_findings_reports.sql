-- Findings and reports — the two things CONTEXT.md says a client_viewer
-- may see ("approved reports and open findings for their own entities
-- only"), plus the internal event log behind a finding that they may not.
--
-- "Open findings" is read as "not yet closed" (status <> 'closed') rather
-- than the single literal status value 'open', since a client tracking
-- outstanding work needs to see in_progress/evidence_submitted/
-- under_review items too, not just brand-new ones. See docs/decisions.md.

create function public.assessment_entity_id(p_assessment_id uuid) returns uuid
language sql stable
as $$
  select entity_id from public.assessments where id = p_assessment_id;
$$;

create function public.assessment_is_issued(p_assessment_id uuid) returns boolean
language sql stable
as $$
  select issued_at is not null from public.assessments where id = p_assessment_id;
$$;

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  assessment_item_id uuid not null references public.assessment_items (id),
  entity_id uuid not null references public.entities (id),
  facility_id uuid references public.facilities (id),
  title text not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  owner_name text,
  owner_email text,
  due_date date,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'evidence_submitted', 'under_review', 'closed')),
  closure_evidence_text text,
  reviewer_decision text,
  closed_at timestamptz,
  repeat_of_finding_id uuid references public.findings (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.findings enable row level security;

create policy "findings_select_staff" on public.findings
  for select to authenticated using (public.is_staff());

create policy "findings_select_client_viewer" on public.findings
  for select to authenticated
  using (
    public.current_user_role() = 'client_viewer'
    and entity_id = public.current_user_entity_id()
    and status <> 'closed'
  );

create policy "findings_write_staff" on public.findings
  for insert to authenticated with check (public.can_write_operational());

create policy "findings_update_staff" on public.findings
  for update to authenticated using (public.is_staff());

-- Internal history of a finding (status changes, comments, escalations).
-- Staff-only — this is the working trail behind a finding, not the
-- finding itself, which is what a client_viewer is scoped to see.
create table public.finding_events (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings (id) on delete cascade,
  event_type text not null,
  note text,
  actor_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.finding_events enable row level security;

create policy "finding_events_select_staff" on public.finding_events
  for select to authenticated using (public.is_staff());

create policy "finding_events_write_staff" on public.finding_events
  for insert to authenticated with check (public.is_staff());

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id),
  version integer not null,
  format text not null,
  storage_path text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users (id),
  is_current boolean not null default true,
  unique (assessment_id, version)
);

alter table public.reports enable row level security;

create policy "reports_select_staff" on public.reports
  for select to authenticated using (public.is_staff());

-- "Approved reports": current version, and only once the assessment has
-- actually been issued to the client.
create policy "reports_select_client_viewer" on public.reports
  for select to authenticated
  using (
    public.current_user_role() = 'client_viewer'
    and is_current
    and public.assessment_entity_id(assessment_id) = public.current_user_entity_id()
    and public.assessment_is_issued(assessment_id)
  );

create policy "reports_write_staff" on public.reports
  for insert to authenticated with check (public.can_write_operational());

create policy "reports_update_staff" on public.reports
  for update to authenticated using (public.can_write_operational());
