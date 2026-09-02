-- Widens evidence_files.review_status to this prompt's five-value
-- workflow (outstanding, received, in_review, reviewed, gap_flagged —
-- 0005_evidence_ai.sql only had pending/reviewed) and adds the
-- many-to-many "link a file to one or more requirements" table coverage
-- is computed from.
--
-- evidence_files.requirement_id (0015_evidence_files_rfi_and_nda.sql)
-- stays as-is and is NOT what coverage reads from: it's the one
-- requirement an RFI checklist line was issued for (upload-time
-- provenance, set once, never edited). evidence_file_requirements below
-- is the assessor-editable, possibly-multi-valued set of requirements a
-- file actually counts as evidence for — a different concept that
-- happens to often overlap with it. See docs/decisions.md.

alter table public.evidence_files drop constraint evidence_files_review_status_check;

update public.evidence_files set review_status = 'received' where review_status = 'pending';

alter table public.evidence_files
  add constraint evidence_files_review_status_check
  check (review_status in ('outstanding', 'received', 'in_review', 'reviewed', 'gap_flagged'));

alter table public.evidence_files alter column review_status set default 'received';

create table public.evidence_file_requirements (
  evidence_file_id uuid not null references public.evidence_files (id) on delete cascade,
  requirement_id uuid not null references public.requirements (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  primary key (evidence_file_id, requirement_id)
);

alter table public.evidence_file_requirements enable row level security;

create policy "evidence_file_requirements_select_staff" on public.evidence_file_requirements
  for select to authenticated using (public.is_staff());

create policy "evidence_file_requirements_write_staff" on public.evidence_file_requirements
  for insert to authenticated with check (public.can_write_operational());

create policy "evidence_file_requirements_delete_staff" on public.evidence_file_requirements
  for delete to authenticated using (public.can_write_operational());

grant select, insert, delete on public.evidence_file_requirements to authenticated;
