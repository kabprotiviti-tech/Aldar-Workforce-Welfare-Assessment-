-- Core: organisations, entities, entity contacts, facilities, and cycles.
--
-- Also closes two gaps left by 0001_init.sql, written before this table
-- list existed: public.users.organisation_id had no FK target yet
-- (organisations didn't exist), and there was no column identifying which
-- entity a client_viewer belongs to — needed to enforce "own entity_id"
-- access below and in every later migration. See docs/decisions.md.

-- ---------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.organisations enable row level security;

-- Close gap 1: users.organisation_id now has somewhere to point.
alter table public.users
  add constraint users_organisation_id_fkey
  foreign key (organisation_id) references public.organisations (id);

-- Close gap 2: which entity a client_viewer belongs to (the FK to
-- public.entities is added once that table exists, further down). Null
-- for every other role.
alter table public.users
  add column entity_id uuid;

-- ---------------------------------------------------------------------
-- RLS helper functions, shared by every migration from here on. Defined
-- only now that users.entity_id exists — `language sql` functions are
-- validated against the catalog at creation time, unlike plpgsql.
-- security invoker (the default): each reads public.users WHERE id =
-- auth.uid(), which the "users_select_own" policy already permits, so no
-- elevated privilege is needed to evaluate them.
-- ---------------------------------------------------------------------

create function public.current_user_role() returns text
language sql stable
as $$
  select role from public.users where id = auth.uid();
$$;

create function public.current_user_entity_id() returns uuid
language sql stable
as $$
  select entity_id from public.users where id = auth.uid();
$$;

-- admin, assessor, qa_reviewer: staff who work across the whole supply
-- chain. client_viewer is deliberately excluded — its access is scoped
-- table-by-table below, never blanket.
create function public.is_staff() returns boolean
language sql stable
as $$
  select public.current_user_role() in ('admin', 'assessor', 'qa_reviewer');
$$;

-- admin and assessor create/maintain operational records (entities,
-- facilities, assessment content); qa_reviewer's write access is limited
-- to the specific review actions granted per-table below.
create function public.can_write_operational() returns boolean
language sql stable
as $$
  select public.current_user_role() in ('admin', 'assessor');
$$;

create policy "organisations_select_staff" on public.organisations
  for select to authenticated using (public.is_staff());

create policy "organisations_write_staff" on public.organisations
  for insert to authenticated with check (public.can_write_operational());

create policy "organisations_update_staff" on public.organisations
  for update to authenticated using (public.can_write_operational());

-- ---------------------------------------------------------------------
-- entities — the supply-chain companies being assessed.
-- ---------------------------------------------------------------------

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity_code text not null unique,
  type text not null check (
    type in ('general_contractor', 'facilities_management', 'asset_operator', 'subcontractor')
  ),
  worker_count integer,
  project_name text,
  project_type text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  first_onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.entities enable row level security;

create policy "entities_select_staff" on public.entities
  for select to authenticated using (public.is_staff());

-- A client_viewer may see only their own entity's row (context for their
-- reports/findings) — never the rest of the supply chain.
create policy "entities_select_client_viewer" on public.entities
  for select to authenticated
  using (
    public.current_user_role() = 'client_viewer'
    and id = public.current_user_entity_id()
  );

create policy "entities_write_staff" on public.entities
  for insert to authenticated with check (public.can_write_operational());

create policy "entities_update_staff" on public.entities
  for update to authenticated using (public.can_write_operational());

alter table public.users
  add constraint users_entity_id_fkey
  foreign key (entity_id) references public.entities (id);

-- ---------------------------------------------------------------------
-- entity_contacts
-- ---------------------------------------------------------------------

create table public.entity_contacts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.entity_contacts enable row level security;

create policy "entity_contacts_select_staff" on public.entity_contacts
  for select to authenticated using (public.is_staff());

create policy "entity_contacts_write_staff" on public.entity_contacts
  for insert to authenticated with check (public.can_write_operational());

create policy "entity_contacts_update_staff" on public.entity_contacts
  for update to authenticated using (public.can_write_operational());

-- ---------------------------------------------------------------------
-- facilities — physical sites inspected under the Accommodation module.
-- ---------------------------------------------------------------------

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id),
  name text not null,
  facility_code text not null unique,
  emirate text,
  area text,
  capacity integer,
  regulatory_body text,
  access_permission_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.facilities enable row level security;

create policy "facilities_select_staff" on public.facilities
  for select to authenticated using (public.is_staff());

create policy "facilities_select_client_viewer" on public.facilities
  for select to authenticated
  using (
    public.current_user_role() = 'client_viewer'
    and entity_id = public.current_user_entity_id()
  );

create policy "facilities_write_staff" on public.facilities
  for insert to authenticated with check (public.can_write_operational());

create policy "facilities_update_staff" on public.facilities
  for update to authenticated using (public.can_write_operational());

-- ---------------------------------------------------------------------
-- cycles — the yearly assessment period every assessment belongs to.
-- ---------------------------------------------------------------------

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  name text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  unique (year, name)
);

alter table public.cycles enable row level security;

create policy "cycles_select_staff" on public.cycles
  for select to authenticated using (public.is_staff());

create policy "cycles_write_staff" on public.cycles
  for insert to authenticated with check (public.can_write_operational());

create policy "cycles_update_staff" on public.cycles
  for update to authenticated using (public.can_write_operational());
