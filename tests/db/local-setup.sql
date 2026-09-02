-- Test-only harness. A real Supabase project already provides auth.users
-- and the anon/authenticated/service_role Postgres roles; this file
-- recreates a minimal stand-in for both so that the real, unmodified
-- production migration (supabase/migrations/0001_init.sql) can be applied
-- and exercised against a plain local Postgres instance.
--
-- Every credential below is a fixed, throwaway local-test password. None of
-- it is a real secret and none of it is used against any live Supabase
-- project.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated login password 'authenticated_test_pw';
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role login password 'service_role_test_pw' bypassrls;
  end if;
end $$;

create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

-- Stand-in for Supabase's auth.uid(), which normally reads the "sub" claim
-- out of the request's JWT. Tests simulate a signed-in user by setting the
-- request.jwt.claim.sub session variable before querying.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
