-- Links evidence_files down to the requirement and the RFI checklist line
-- it satisfies, lets an upload be attributed to an entity contact instead
-- of a Supabase user (the RFI portal has no account), adds the virus-scan
-- status this prompt asks for, and adds the NDA flag on entities.

-- requirement_id: "linked to the assessment and the requirement" (this
-- prompt's acceptance criterion) — evidence_files already links to the
-- assessment; this is the missing half.
alter table public.evidence_files add column requirement_id uuid references public.requirements (id);

-- Which RFI checklist line this file was uploaded against, if any (staff
-- uploads elsewhere, e.g. the access letter, leave this null).
alter table public.evidence_files add column rfi_checklist_item_id uuid references public.rfi_checklist_items (id);

-- A portal upload has no Supabase user to attribute uploaded_by to — "the
-- uploader recorded as the entity contact" (this prompt) instead. Exactly
-- one of uploaded_by/uploaded_by_contact_id is set, depending on whether
-- the upload came from a signed-in staff member or the public portal.
alter table public.evidence_files add column uploaded_by_contact_id uuid references public.entity_contacts (id);
alter table public.evidence_files alter column uploaded_by drop not null;
alter table public.evidence_files add constraint evidence_files_uploader_check
  check (
    (uploaded_by is not null and uploaded_by_contact_id is null)
    or (uploaded_by is null and uploaded_by_contact_id is not null)
  );

-- Virus scan hook (this prompt: "stub is acceptable for MVP, wired so it
-- can be swapped for a real scanner") — lib/rfi/virus-scan.ts. 'pending'
-- until the (stub) scanner runs, which happens synchronously today but is
-- a status column, not a boolean, so a real async scanner can update it
-- later without a schema change.
alter table public.evidence_files add column virus_scan_status text not null default 'pending'
  check (virus_scan_status in ('pending', 'clean', 'infected', 'error'));
alter table public.evidence_files add column virus_scanned_at timestamptz;

-- No new insert policy for the contact-attributed shape: a portal upload
-- has no Supabase session at all, so it writes via the service-role
-- client (bypasses RLS by design, lib/supabase/admin.ts) — the same way
-- extractions/ai_observations are written in 0005_evidence_ai.sql. There
-- is no "authenticated but acting as a contact" case for RLS to permit.

-- NDA flag on entities (this prompt): if set, staff must confirm an NDA is
-- in place before that entity's evidence can be opened. One confirmation
-- unlocks it for every staff member, not per-viewer/per-session — see
-- docs/decisions.md.
alter table public.entities add column nda_required boolean not null default false;
alter table public.entities add column nda_confirmed_at timestamptz;
alter table public.entities add column nda_confirmed_by uuid references auth.users (id);
