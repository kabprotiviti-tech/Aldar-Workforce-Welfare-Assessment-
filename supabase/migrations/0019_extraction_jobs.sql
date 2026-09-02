-- The extraction queue (this prompt: "a queue so a batch of 18 documents
-- extracts in the background with visible progress"). One row per
-- document in a batch; batch_id groups the rows a single "extract all"
-- action created, so progress ("N of 18 done") is a single count query.
--
-- Written and read exclusively by server code via the service-role
-- client (lib/ai/queue.ts, app/api/ai/*) — the same reasoning as
-- extractions/extracted_facts: nothing about queue mechanics needs an
-- authenticated user's own session, and RLS below exists only so staff
-- can see a batch's status from the UI.

create table public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  evidence_file_id uuid not null references public.evidence_files (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  error text,
  extraction_id uuid references public.extractions (id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users (id)
);

create index extraction_jobs_batch_id_idx on public.extraction_jobs (batch_id);
-- Used by the stuck-job sweep (app/api/ai/sweep-stuck-jobs) to find jobs
-- claimed by a request that never finished (e.g. an "after()" background
-- task killed mid-batch by a serverless duration limit).
create index extraction_jobs_status_started_at_idx on public.extraction_jobs (status, started_at);

alter table public.extraction_jobs enable row level security;

create policy "extraction_jobs_select_staff" on public.extraction_jobs
  for select to authenticated using (public.is_staff());

grant select on public.extraction_jobs to authenticated;
