-- Rules and measurement: the typed rule engine's own reference data and
-- its computation log, plus room measurements and site photos.
--
-- rooms.computed_m2_per_person is a generated column, not a value any
-- caller sets — CONTEXT.md rule 2 ("the model never performs arithmetic
-- ... a typed rule engine evaluates") applies just as much to a human
-- typing numbers into a form as it does to the model. The database
-- computes it once, the same way, every time.

create table public.rule_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  module text not null check (module in ('employment_practices', 'onboarding', 'accommodation')),
  requirement_id uuid not null references public.requirements (id),
  description text,
  input_fact_keys text[] not null default '{}',
  threshold jsonb,
  legal_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.rule_definitions enable row level security;

create policy "rule_definitions_select_staff" on public.rule_definitions
  for select to authenticated using (public.is_staff());

create policy "rule_definitions_write_admin" on public.rule_definitions
  for insert to authenticated with check (public.is_admin());

create policy "rule_definitions_update_admin" on public.rule_definitions
  for update to authenticated using (public.is_admin());

-- One evaluation run. Append-only: a re-evaluation (new inputs, a
-- corrected fact, a later cycle) is a new row, never an edit to a past
-- one — the same reproducibility reasoning as checklist_templates.
create table public.rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  assessment_item_id uuid not null references public.assessment_items (id) on delete cascade,
  rule_code text not null references public.rule_definitions (code),
  inputs jsonb not null,
  result text not null check (result in ('pass', 'fail', 'insufficient_data')),
  computed_explanation text,
  evaluated_at timestamptz not null default now()
);

alter table public.rule_evaluations enable row level security;

create policy "rule_evaluations_select_staff" on public.rule_evaluations
  for select to authenticated using (public.is_staff());

create policy "rule_evaluations_write_staff" on public.rule_evaluations
  for insert to authenticated with check (public.can_write_operational());

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  room_ref text not null,
  drawing_area_m2 numeric,
  drawing_source_file_id uuid references public.evidence_files (id),
  measured_area_m2 numeric,
  bed_count integer,
  occupancy_count integer,
  computed_m2_per_person numeric generated always as (
    case
      when occupancy_count is null or occupancy_count = 0 then null
      else coalesce(measured_area_m2, drawing_area_m2) / occupancy_count
    end
  ) stored,
  source text not null default 'manual' check (source in ('drawing', 'manual', 'both')),
  confirmed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  unique (facility_id, room_ref)
);

alter table public.rooms enable row level security;

create policy "rooms_select_staff" on public.rooms
  for select to authenticated using (public.is_staff());

create policy "rooms_write_staff" on public.rooms
  for insert to authenticated with check (public.can_write_operational());

create policy "rooms_update_staff" on public.rooms
  for update to authenticated using (public.can_write_operational());

-- requirement_id doubles as "area_id" for the Accommodation module, where
-- a checklist_templates row's "requirements" are its 12 assessment areas
-- — one table, two names depending on module (see docs/schema.md).
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  requirement_id uuid references public.requirements (id),
  storage_path text not null,
  captured_at timestamptz,
  geo_lat numeric,
  geo_lng numeric,
  caption text,
  analysis_id uuid references public.extractions (id),
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.photos enable row level security;

create policy "photos_select_staff" on public.photos
  for select to authenticated using (public.is_staff());

create policy "photos_write_staff" on public.photos
  for insert to authenticated with check (public.can_write_operational());

create policy "photos_update_staff" on public.photos
  for update to authenticated using (public.can_write_operational());
