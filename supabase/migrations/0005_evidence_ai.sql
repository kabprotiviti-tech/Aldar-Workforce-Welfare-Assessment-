-- Evidence and AI: uploaded documents, the extraction runs against them,
-- the individual facts a model proposed, and the observations it raised.
-- Staff-only across the board — a client_viewer's role is scoped to
-- "approved reports and open findings" (CONTEXT.md), not the working
-- material behind them.
--
-- Insert policies deliberately don't exist for extractions, extracted_facts,
-- or ai_observations: those rows are written by server code using the
-- service-role client (lib/supabase/admin.ts), which bypasses RLS by
-- design — never by an authenticated user directly, so there's nothing
-- for an authenticated-role INSERT policy to permit. Their UPDATE
-- policies exist because a human *resolving* a fact or observation acts
-- as themselves, through the normal session-scoped client.

create table public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  document_class text,
  uploaded_by uuid not null references auth.users (id),
  uploaded_at timestamptz not null default now(),
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  updated_at timestamptz not null default now()
);

alter table public.evidence_files enable row level security;

create policy "evidence_files_select_staff" on public.evidence_files
  for select to authenticated using (public.is_staff());

create policy "evidence_files_write_staff" on public.evidence_files
  for insert to authenticated with check (public.can_write_operational());

create policy "evidence_files_update_staff" on public.evidence_files
  for update to authenticated using (public.is_staff());

-- The model never sets a compliance status and never does arithmetic
-- (CONTEXT.md rule 2) — this table is exactly "what the model returned",
-- immutable once written. No updated_at: nothing should ever change a
-- past extraction run.
create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  evidence_file_id uuid not null references public.evidence_files (id) on delete cascade,
  model text not null,
  prompt_version text not null,
  raw_response jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  created_at timestamptz not null default now(),
  error text
);

alter table public.extractions enable row level security;

create policy "extractions_select_staff" on public.extractions
  for select to authenticated using (public.is_staff());

-- One proposed value from an extraction run, and the human decision on
-- it. status/resolved_* start out system-set (proposed) and are then
-- updated by whichever assessor accepts, edits, or rejects the value —
-- CONTEXT.md rule 4: nothing reaches a report without that step.
create table public.extracted_facts (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  evidence_file_id uuid not null references public.evidence_files (id),
  fact_key text not null,
  value_text text,
  value_number numeric,
  value_date date,
  unit text,
  page_ref text,
  confidence numeric,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'edited', 'rejected')),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  resolved_value_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.extracted_facts enable row level security;

create policy "extracted_facts_select_staff" on public.extracted_facts
  for select to authenticated using (public.is_staff());

create policy "extracted_facts_update_staff" on public.extracted_facts
  for update to authenticated using (public.is_staff());

-- Observations the model raised for a human to look at (rule 3: it
-- produces observations only, never a status). confirmed/rejected/noted
-- is the human's call, recorded in actioned_by/actioned_at.
create table public.ai_observations (
  id uuid primary key default gen_random_uuid(),
  assessment_item_id uuid not null references public.assessment_items (id) on delete cascade,
  kind text not null check (kind in ('evidence_identified', 'potential_gap', 'requires_attention')),
  title text not null,
  body text,
  source_ref text,
  evidence_file_id uuid references public.evidence_files (id),
  status text not null default 'open' check (status in ('open', 'confirmed', 'rejected', 'noted')),
  actioned_by uuid references auth.users (id),
  actioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_observations enable row level security;

create policy "ai_observations_select_staff" on public.ai_observations
  for select to authenticated using (public.is_staff());

create policy "ai_observations_update_staff" on public.ai_observations
  for update to authenticated using (public.is_staff());
