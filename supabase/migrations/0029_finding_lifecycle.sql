-- Finding lifecycle management across cycles (this prompt): closing a
-- finding requires closure evidence and a reviewer decision, and neither
-- can be skipped; a closed finding cannot be edited, only reopened. Both
-- guarantees are written as triggers, not application checks — the same
-- reasoning as 0024_assessment_decision.sql's status-write trigger: RLS
-- can't stop the service-role/table-owner connection this app's own
-- server code runs under from doing either thing by accident, so the
-- guarantee has to live below RLS.

-- The action owner (this prompt: "name, email, organisation"). Kept as an
-- editable free-text snapshot — same reasoning as rfi_checklist_items
-- snapshotting a document template's name — because a finding's owner is
-- often a contractor with no Supabase account and no entity_contacts row
-- at all. owner_contact_id is the one exception: set only when the owner
-- *is* a known entity contact, which is required before a closure portal
-- link can be issued (the portal has no session, so an uploaded file's
-- uploaded_by_contact_id has to come from somewhere real — see
-- lib/findings/closure-portal-supabase.ts).
alter table public.findings add column owner_organisation text;
alter table public.findings add column owner_contact_id uuid references public.entity_contacts (id);

-- reviewer_decision was free text with no writer at all until this
-- prompt. Constraining it now that it's a real field: "accept closure, or
-- reject with reason and a new due date" is exactly two outcomes, and
-- "partial closure is explicitly not acceptance" is enforced by there
-- being no third value to write.
alter table public.findings add constraint findings_reviewer_decision_check
  check (reviewer_decision is null or reviewer_decision in ('accepted', 'rejected'));
alter table public.findings add column reviewer_decision_reason text;
alter table public.findings add column reviewer_decision_at timestamptz;
alter table public.findings add column reviewer_decision_by uuid references auth.users (id);

-- Closure evidence (this prompt: "uploads closure evidence, adds a
-- note") is one or more evidence_files rows, not just the existing
-- closure_evidence_text column — that column becomes the owner's note
-- alongside the upload, not a substitute for it.
alter table public.evidence_files add column finding_id uuid references public.findings (id);

-- A closed finding is immutable except for a reopen. "Reopen" is defined
-- narrowly: status flips back to 'open' and nothing else about the
-- finding's substance changes in the same statement (the closure record
-- itself is cleared here, deliberately, because a reopened finding needs
-- fresh closure evidence and a fresh reviewer decision — carrying the old
-- ones forward would let a reopened finding look closed again without
-- either).
create function public.enforce_finding_closed_immutability() returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed' then
    if new.status <> 'open'
       or new.title is distinct from old.title
       or new.priority is distinct from old.priority
       or new.owner_name is distinct from old.owner_name
       or new.owner_email is distinct from old.owner_email
       or new.owner_organisation is distinct from old.owner_organisation
       or new.owner_contact_id is distinct from old.owner_contact_id
       or new.entity_id is distinct from old.entity_id
       or new.facility_id is distinct from old.facility_id
       or new.assessment_item_id is distinct from old.assessment_item_id
       or new.repeat_of_finding_id is distinct from old.repeat_of_finding_id
       or new.closure_evidence_text is distinct from old.closure_evidence_text
    then
      raise exception 'A closed finding cannot be edited — reopen it first.';
    end if;

    new.reviewer_decision := null;
    new.reviewer_decision_reason := null;
    new.reviewer_decision_at := null;
    new.reviewer_decision_by := null;
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger finding_closed_immutability
  before update on public.findings
  for each row execute function public.enforce_finding_closed_immutability();

-- Closing requires closure evidence (at least one evidence_files row
-- against this finding) and a reviewer decision of 'accepted' — a
-- rejected review, or no review at all, cannot close a finding. Fires on
-- the transition into 'closed', not on every update, so an already-closed
-- row never re-checks this (the immutability trigger above owns that
-- case, and fires first: 'finding_closed_immutability' sorts before
-- 'finding_closure_requirements').
create function public.enforce_finding_closure_requirements() returns trigger
language plpgsql
as $$
declare
  evidence_count integer;
begin
  if new.status = 'closed' and (old is null or old.status <> 'closed') then
    if new.reviewer_decision is distinct from 'accepted' then
      raise exception 'A finding can only be closed once a reviewer accepts the closure.';
    end if;

    select count(*) into evidence_count from public.evidence_files where finding_id = new.id;
    if evidence_count = 0 then
      raise exception 'A finding cannot be closed without closure evidence.';
    end if;

    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

create trigger finding_closure_requirements
  before insert or update on public.findings
  for each row execute function public.enforce_finding_closure_requirements();

-- The entity-facing closure portal (this prompt: "same tokenised pattern
-- as the RFI portal"). A separate table from rfi_tokens because it
-- references a different parent (finding_id, not rfi_request_id) — the
-- token/hash/expiry mechanics themselves are the same generic primitives
-- in lib/rfi/token.ts, reused rather than reimplemented. No RLS policies
-- at all, same reasoning as rfi_tokens: only server code holding the
-- service-role client ever touches this table, for the portal (no
-- account) and for staff issuing/revoking a link.
create table public.finding_closure_tokens (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.finding_closure_tokens enable row level security;

-- Every attempt to use a closure token, valid or not — the same "logged"
-- half of the RFI portal's own access guarantee, and the same reason for
-- a purpose-built log instead of audit_log: these attempts have no
-- actor_id and need a fast, token-scoped lookup for rate limiting.
create table public.finding_closure_token_access_log (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  ip text,
  outcome text not null check (outcome in ('success', 'invalid', 'expired', 'revoked', 'rate_limited')),
  created_at timestamptz not null default now()
);

alter table public.finding_closure_token_access_log enable row level security;

create policy "finding_closure_token_access_log_select_staff" on public.finding_closure_token_access_log
  for select to authenticated using (public.is_staff());

-- Escalation dedupe ledger (this prompt: "overdue by 30 days notifies the
-- assessment owner; overdue by 60 days or any high-priority safety
-- finding notifies an admin"), the same unique-constraint-as-atomic-guard
-- shape as rfi_reminders_sent — one row per (finding, kind) ever sent, so
-- a daily sweep never double-notifies. 'admin_high_priority' has no
-- "days" component: it fires once, the first time a high-priority finding
-- is swept while still open, independent of its due date.
create table public.finding_escalations_sent (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings (id) on delete cascade,
  kind text not null check (kind in ('owner_overdue_30', 'admin_overdue_60', 'admin_high_priority')),
  sent_at timestamptz not null default now(),
  unique (finding_id, kind)
);

alter table public.finding_escalations_sent enable row level security;

create policy "finding_escalations_sent_select_staff" on public.finding_escalations_sent
  for select to authenticated using (public.is_staff());

grant select on public.finding_closure_token_access_log, public.finding_escalations_sent to authenticated;
