-- WWAP: user profiles and the append-only audit log.
--
-- Assumes a real Supabase project: auth.users and the anon/authenticated/
-- service_role roles already exist and are managed by Supabase Auth. This
-- file does not create or alter anything under the auth schema.

create extension if not exists pgcrypto;

-- public.users extends auth.users with the profile fields the app needs.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'assessor', 'qa_reviewer', 'client_viewer')),
  organisation_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users_select_own" on public.users
  for select
  to authenticated
  using (auth.uid() = id);

-- public.audit_log: append-only record of every write a human or the
-- system makes. actor_id is who did it; before/after are the row's state
-- immediately either side of the change.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- Table-level grants include update/delete on purpose: with no policy
-- permitting either command, Postgres denies both regardless of the grant,
-- so it's unambiguously the RLS policy doing the enforcing here, not a
-- missing GRANT. (service_role bypasses RLS by design in Postgres/Supabase
-- and always will — writeAudit() only ever calls insert(), so that bypass
-- is never exercised by this app. See docs/decisions.md.)
grant select, insert, update, delete on public.audit_log to authenticated;

create policy "audit_log_select_authenticated" on public.audit_log
  for select
  to authenticated
  using (true);

create policy "audit_log_insert_authenticated" on public.audit_log
  for insert
  to authenticated
  with check (true);

create policy "audit_log_no_update" on public.audit_log
  for update
  using (false);

create policy "audit_log_no_delete" on public.audit_log
  for delete
  using (false);
