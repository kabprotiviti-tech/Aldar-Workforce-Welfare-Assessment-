-- Configures the "reports" Storage bucket a generated report's JSON
-- snapshot is uploaded to (lib/reports/generate-supabase.ts) — the file
-- half of "preserves the earlier report file and its data exactly."
--
-- Operates on storage.buckets/storage.objects, which only exist in a
-- real Supabase project — deliberately excluded from
-- tests/db/helpers.ts's migration list, the same reasoning as
-- 0016_evidence_bucket.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 10485760, array['application/json'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Report generation always goes through the service-role client
-- (lib/reports/generate-supabase.ts, called from the approval RPC's
-- caller) — the same reasoning as the evidence bucket's write policy
-- existing only for the ordinary staff case. This select policy is for
-- staff reading a report file back (e.g. a download link).
create policy "reports_bucket_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'reports' and public.is_staff());
