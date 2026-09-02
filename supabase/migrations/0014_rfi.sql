-- Request-for-information (RFI) flow (this prompt): document templates per
-- module mapped to the requirement(s) they evidence, an RFI issued for one
-- assessment, its document checklist, and the tokenised-portal access
-- mechanism. The portal itself has no Supabase Auth account — everything
-- here is written and read by server code using the service-role client
-- (lib/supabase/admin.ts), the same way extractions/ai_observations are in
-- 0005_evidence_ai.sql, so RLS policies below exist only for the staff
-- (authenticated) side: browsing templates, issuing RFIs, the intake
-- dashboard.

create table public.rfi_document_templates (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('employment_practices', 'onboarding', 'accommodation')),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.rfi_document_templates enable row level security;

create policy "rfi_document_templates_select_staff" on public.rfi_document_templates
  for select to authenticated using (public.is_staff());

create policy "rfi_document_templates_write_admin" on public.rfi_document_templates
  for insert to authenticated with check (public.is_admin());

create policy "rfi_document_templates_update_admin" on public.rfi_document_templates
  for update to authenticated using (public.is_admin());

-- Which requirement(s) a document type evidences. Many-to-many: one
-- document (e.g. "Payroll register") can evidence several requirements,
-- and a requirement can be evidenced by several document types.
create table public.rfi_document_template_requirements (
  document_template_id uuid not null references public.rfi_document_templates (id) on delete cascade,
  requirement_id uuid not null references public.requirements (id),
  primary key (document_template_id, requirement_id)
);

alter table public.rfi_document_template_requirements enable row level security;

create policy "rfi_document_template_requirements_select_staff" on public.rfi_document_template_requirements
  for select to authenticated using (public.is_staff());

create policy "rfi_document_template_requirements_write_admin" on public.rfi_document_template_requirements
  for insert to authenticated with check (public.is_admin());

create table public.rfi_requests (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id),
  contact_id uuid not null references public.entity_contacts (id),
  status text not null default 'open' check (status in ('open', 'completed', 'expired', 'cancelled')),
  issued_at timestamptz not null default now(),
  -- Default 14 calendar days from issue (this prompt: "from receipt" —
  -- read as receipt of the RFI itself, i.e. when it's sent, which is the
  -- only one of the two dates this system actually controls). Calendar
  -- days, not UAE working days — the brief only asks for working-day
  -- arithmetic on the report deadline, not this one. See docs/decisions.md.
  due_date date not null default (current_date + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

alter table public.rfi_requests enable row level security;

create policy "rfi_requests_select_staff" on public.rfi_requests
  for select to authenticated using (public.is_staff());

create policy "rfi_requests_write_staff" on public.rfi_requests
  for insert to authenticated with check (public.can_write_operational());

create policy "rfi_requests_update_staff" on public.rfi_requests
  for update to authenticated using (public.is_staff());

-- One row per (document type, requirement it evidences) requested in this
-- RFI — so "outstanding vs. received" and the evidence_files link this
-- prompt asks for ("linked to ... the requirement") are both unambiguous,
-- even when one document type evidences several requirements. name/
-- description are a snapshot of the template at issue time, so a later
-- edit to rfi_document_templates never rewrites an RFI already sent.
create table public.rfi_checklist_items (
  id uuid primary key default gen_random_uuid(),
  rfi_request_id uuid not null references public.rfi_requests (id) on delete cascade,
  document_template_id uuid references public.rfi_document_templates (id),
  requirement_id uuid not null references public.requirements (id),
  name text not null,
  status text not null default 'outstanding' check (status in ('outstanding', 'received', 'waived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rfi_checklist_items enable row level security;

create policy "rfi_checklist_items_select_staff" on public.rfi_checklist_items
  for select to authenticated using (public.is_staff());

create policy "rfi_checklist_items_write_staff" on public.rfi_checklist_items
  for insert to authenticated with check (public.can_write_operational());

create policy "rfi_checklist_items_update_staff" on public.rfi_checklist_items
  for update to authenticated using (public.is_staff());

-- The tokenised portal link. Only a hash of the token is ever stored
-- (lib/rfi/token.ts) — the raw token exists only in the emailed link and
-- the requester's browser, never at rest, the same reasoning as a
-- password hash. expires_at + revoked_at are the two ways a token stops
-- working; both are checked on every portal request
-- (lib/rfi/portal.ts's validateToken).
create table public.rfi_tokens (
  id uuid primary key default gen_random_uuid(),
  rfi_request_id uuid not null references public.rfi_requests (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.rfi_tokens enable row level security;

-- No policies at all: this table is never read or written by an
-- authenticated Supabase session — only by server code holding the
-- service-role client, for the portal itself (no account) and for staff
-- server actions issuing/revoking a token. See docs/decisions.md.

-- Every attempt to use a portal token, valid or not — this is the "logged"
-- half of "an expired or tampered token returns 403 and is logged." A
-- second, purpose-built log rather than public.audit_log, since these
-- attempts have no actor_id (there is no signed-in user) and need a fast,
-- token-scoped lookup for rate limiting, which audit_log isn't shaped for.
create table public.rfi_token_access_log (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  ip text,
  outcome text not null check (outcome in ('success', 'invalid', 'expired', 'revoked', 'rate_limited')),
  created_at timestamptz not null default now()
);

alter table public.rfi_token_access_log enable row level security;

create policy "rfi_token_access_log_select_staff" on public.rfi_token_access_log
  for select to authenticated using (public.is_staff());

-- Dedupe ledger for the reminder schedule (this prompt: due date minus 3
-- days, on the due date, and once overdue) — one row per (request, kind)
-- ever sent, so a scheduler firing more than once a day, or a retry,
-- never double-sends the same reminder.
create table public.rfi_reminders_sent (
  id uuid primary key default gen_random_uuid(),
  rfi_request_id uuid not null references public.rfi_requests (id) on delete cascade,
  kind text not null check (kind in ('due_minus_3', 'due_date', 'overdue')),
  sent_at timestamptz not null default now(),
  unique (rfi_request_id, kind)
);

alter table public.rfi_reminders_sent enable row level security;

create policy "rfi_reminders_sent_select_staff" on public.rfi_reminders_sent
  for select to authenticated using (public.is_staff());

grant select, insert, update on
  public.rfi_document_templates,
  public.rfi_requests,
  public.rfi_checklist_items
to authenticated;
grant select, insert on public.rfi_document_template_requirements to authenticated;
grant select on public.rfi_token_access_log, public.rfi_reminders_sent to authenticated;
