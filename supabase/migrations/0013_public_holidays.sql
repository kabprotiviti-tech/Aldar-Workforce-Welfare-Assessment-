-- UAE public holiday calendar. Report deadlines (report_due_date =
-- actual_visit_date + 10 working days, lib/scheduling/working-days.ts)
-- treat Saturday/Sunday as the weekend (the UAE government workweek since
-- January 2022) and every date in this table as a non-working day.
--
-- Seeded here with only the fixed-Gregorian-date UAE public holidays
-- (New Year's Day, Commemoration Day, National Day) for 2025-2026 — the
-- Islamic-calendar holidays (Eid al-Fitr, Arafat Day/Eid al-Adha, Islamic
-- New Year, Prophet Muhammad's Birthday) are set by moon sighting and
-- officially announced only shortly beforehand, so their exact dates are
-- not something to guess this far out. That is exactly why this table is
-- editable in Settings rather than a hard-coded constant: an admin adds
-- each year's Islamic holidays once the UAE government announces them.
-- See docs/decisions.md.

create table public.public_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  unique (holiday_date)
);

alter table public.public_holidays enable row level security;

-- Read access matches every other operational table (staff-wide); write
-- access is admin-only, like checklist_templates — this is shared
-- reference data that changes deadline computation for every module.
create policy "public_holidays_select_staff" on public.public_holidays
  for select to authenticated using (public.is_staff());

create policy "public_holidays_write_admin" on public.public_holidays
  for insert to authenticated with check (public.is_admin());

create policy "public_holidays_update_admin" on public.public_holidays
  for update to authenticated using (public.is_admin());

grant select, insert, update on public.public_holidays to authenticated;

insert into public.public_holidays (holiday_date, name) values
  ('2025-01-01', 'New Year''s Day'),
  ('2025-12-01', 'Commemoration Day'),
  ('2025-12-02', 'National Day'),
  ('2025-12-03', 'National Day (in lieu)'),
  ('2026-01-01', 'New Year''s Day'),
  ('2026-12-01', 'Commemoration Day'),
  ('2026-12-02', 'National Day'),
  ('2026-12-03', 'National Day (in lieu)');
