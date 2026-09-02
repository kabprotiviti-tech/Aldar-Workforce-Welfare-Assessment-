-- Configures the "evidence" Storage bucket this prompt's upload
-- constraints apply to at the Storage layer itself, not only in
-- application code: accept pdf/jpg/jpeg/png/xlsx/docx/zip, 50MB per file.
-- lib/evidence/upload-validation.ts enforces the same limits before ever
-- issuing a signed upload URL — this is defense in depth, not the only
-- check, since it can't itself produce this prompt's "clear message" (a
-- Storage-layer rejection is a generic API error, not application copy).
--
-- Operates on storage.buckets/storage.objects, which only exist in a real
-- Supabase project — the local Postgres test harness (tests/db/) has no
-- storage schema, so this migration is deliberately excluded from
-- tests/db/helpers.ts's migration list. See docs/decisions.md.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  52428800, -- 50MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/x-zip-compressed'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Staff can read and write objects in this bucket; a portal upload
-- (lib/rfi/portal-supabase.ts) and the signed-upload flow
-- (lib/evidence/actions.ts) both go through the service-role client
-- instead, which bypasses these policies entirely — they exist for the
-- ordinary authenticated-staff case (e.g. the access letter upload in
-- lib/assessments/actions.ts, which uses the normal session-scoped
-- client).
create policy "evidence_bucket_select_staff" on storage.objects
  for select to authenticated
  using (bucket_id = 'evidence' and public.is_staff());

create policy "evidence_bucket_write_staff" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'evidence' and public.can_write_operational());
