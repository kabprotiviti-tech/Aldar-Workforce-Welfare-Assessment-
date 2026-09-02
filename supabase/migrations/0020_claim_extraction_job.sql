-- Atomic claim for the extraction queue (lib/ai/queue.ts's claimNextJob):
-- marks one queued job in a batch as running and returns everything the
-- worker needs to process it, in a single round trip. FOR UPDATE SKIP
-- LOCKED means two overlapping workers (e.g. the stuck-job sweep retrying
-- a batch a killed background run left stuck) never claim the same row.
create function public.claim_next_extraction_job(p_batch_id uuid)
returns table (
  job_id uuid,
  evidence_file_id uuid,
  document_class text,
  storage_path text,
  mime_type text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  select id into v_job_id
  from public.extraction_jobs
  where batch_id = p_batch_id and status = 'queued'
  order by created_at
  limit 1
  for update skip locked;

  if v_job_id is null then
    return;
  end if;

  update public.extraction_jobs
  set status = 'running', started_at = now()
  where id = v_job_id;

  return query
  select j.id, j.evidence_file_id, e.document_class, e.storage_path, e.mime_type
  from public.extraction_jobs j
  join public.evidence_files e on e.id = j.evidence_file_id
  where j.id = v_job_id;
end;
$$;

-- Written only by the service-role client (lib/ai/queue-supabase.ts), same
-- reasoning as extraction_jobs itself — no authenticated-user grant needed.
grant execute on function public.claim_next_extraction_job(uuid) to service_role;
