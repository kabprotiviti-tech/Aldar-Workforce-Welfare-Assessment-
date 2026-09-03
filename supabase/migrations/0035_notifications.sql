-- Dedupe ledgers for the two new notification schedules (this prompt:
-- "daily digest per assessor... 3-day/1-day deadline warnings") — the
-- same unique-constraint-as-atomic-guard shape as rfi_reminders_sent
-- and finding_escalations_sent: the insert either succeeds (first time
-- today) or fails with a unique violation (already sent), which is
-- race-safe in a way a separate select-then-insert wouldn't be, and
-- lets a scheduler that runs more than once a day, or misses a day,
-- never double-send.

create table public.report_deadline_warnings_sent (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  kind text not null check (kind in ('due_minus_3', 'due_minus_1')),
  sent_at timestamptz not null default now(),
  unique (assessment_id, kind)
);

alter table public.report_deadline_warnings_sent enable row level security;

create policy "report_deadline_warnings_sent_select_staff" on public.report_deadline_warnings_sent
  for select to authenticated using (public.is_staff());

grant select on public.report_deadline_warnings_sent to authenticated;

-- Keyed by calendar date, not a kind vocabulary — "daily" digest, once
-- per assessor per day, however many times the scheduler fires.
create table public.notification_digests_sent (
  id uuid primary key default gen_random_uuid(),
  assessor_id uuid not null references auth.users (id) on delete cascade,
  digest_date date not null,
  sent_at timestamptz not null default now(),
  unique (assessor_id, digest_date)
);

alter table public.notification_digests_sent enable row level security;

create policy "notification_digests_sent_select_staff" on public.notification_digests_sent
  for select to authenticated using (public.is_staff());

grant select on public.notification_digests_sent to authenticated;
