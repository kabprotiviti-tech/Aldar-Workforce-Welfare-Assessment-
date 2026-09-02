# Schema

Source of truth is `supabase/migrations/`. This file is a scaffold — one section
per table, kept short — updated in the same commit as any migration that adds,
drops, or changes a table, per the convention in CONTEXT.md.

## public.users

Extends `auth.users` (Supabase-managed) with the profile fields the app needs.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | = auth.users.id, cascades on delete |
| full_name | text | not null |
| role | text | not null; one of admin, assessor, qa_reviewer, client_viewer |
| organisation_id | uuid | nullable — no organisations table yet |
| active | boolean | not null, default true |
| created_at | timestamptz | not null, default now() |
| updated_at | timestamptz | not null, default now() |

RLS: a user may `select` their own row (`auth.uid() = id`). No insert/update/delete
policy exists yet — provisioning a new user's profile row is a manual/admin step
until a signup or admin-provisioning flow is built.

## public.audit_log

Append-only record of every write a human or the system makes. `before`/`after`
are the row's state immediately either side of the change; `actor_id` is who (or
what service) did it.

| Column | Type | Notes |
|---|---|---|
| id | uuid, PK | default gen_random_uuid() |
| actor_id | uuid | references auth.users, nullable (system-initiated writes) |
| action | text | not null, e.g. "create", "update_status" |
| entity_type | text | not null, e.g. "requirement_assessment" |
| entity_id | text | not null |
| before | jsonb | nullable |
| after | jsonb | nullable |
| created_at | timestamptz | not null, default now() |

RLS: `authenticated` may `select` and `insert`. No `update` or `delete` policy
exists for any role, so both are denied outright regardless of table-level
grants — see docs/decisions.md for how that's proven and its one known limit
(`service_role` bypasses RLS by Postgres/Supabase design; `writeAudit()` never
calls update/delete, so that bypass is never exercised by this app).

Write path: always `lib/audit.ts`'s `writeAudit()`, which uses the service-role
client so the log outlives the actor's own session and RLS.
