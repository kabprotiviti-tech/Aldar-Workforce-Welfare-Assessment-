-- The fact ledger: the human gate between extraction and everything
-- downstream (this prompt). CONTEXT.md rule 4 already says nothing
-- reaches a report without a person confirming it; this migration is what
-- makes that structurally true rather than a convention every future
-- query has to remember.

-- "Reject (with reason)" (this prompt). Deliberately a separate column
-- from extracted_facts.reason, which is the *model's* reason for finding
-- no value at all ('not_present'/'illegible', 0018_extracted_facts_shape.sql).
-- One is the model explaining an absence; this is a human explaining a
-- refusal. Collapsing them would lose the difference.
alter table public.extracted_facts add column rejection_reason text;

-- Optional region of the page a fact was read from, so the preview can
-- highlight it ("highlights the region if a bounding box is available" —
-- this prompt). Normalized 0-1 coordinates relative to the page/image,
-- shaped {"page": 1, "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.05}
-- (factBboxSchema, lib/db/evidence.ts). Nullable and expected to stay
-- null for now: the v1 extraction prompts don't ask the model for
-- coordinates, because a model asked to invent pixel geometry produces
-- confident nonsense — see docs/decisions.md. The column and the UI path
-- exist so a source that genuinely has coordinates (an OCR pass, a
-- future tool-use response) can fill it without a schema change.
alter table public.extracted_facts add column bbox jsonb;

-- The only read path for facts (this prompt: "no downstream query reads
-- extracted_facts where status = 'proposed'... enforce this with a
-- database view fact_ledger_confirmed and make it the only read path").
--
-- Two jobs, both of which every downstream consumer would otherwise have
-- to re-implement correctly, every time:
--
-- 1. Filter to confirmed facts only. 'proposed' has never been reviewed
--    by a person and 'rejected' was actively refused by one; neither is
--    consumable.
-- 2. Resolve which value is the real one. For an 'edited' fact the
--    assessor's value in resolved_value_json is authoritative and the
--    model's original value_* columns are historical provenance. The
--    view exposes one canonical `confirmed_value` and deliberately does
--    NOT re-expose the raw value_* columns, so a consumer physically
--    cannot read the model's superseded proposal by mistake.
--
-- security_invoker = true so the view is subject to the *caller's* RLS
-- against extracted_facts/evidence_files rather than the view owner's
-- (Postgres's default for views is owner rights, which would silently
-- bypass the staff-only policies in 0005_evidence_ai.sql).
create view public.fact_ledger_confirmed
with (security_invoker = true)
as
select
  f.id,
  f.extraction_id,
  f.evidence_file_id,
  e.assessment_id,
  f.fact_key,
  case
    when f.status = 'edited' then f.resolved_value_json -> 'value'
    else coalesce(
      f.value_json,
      to_jsonb(f.value_text),
      to_jsonb(f.value_number),
      to_jsonb(f.value_date),
      to_jsonb(f.value_boolean)
    )
  end as confirmed_value,
  f.unit,
  f.page_ref,
  f.verbatim_quote,
  f.confidence,
  f.status,
  f.resolved_by,
  f.resolved_at,
  f.created_at,
  f.updated_at
from public.extracted_facts f
join public.evidence_files e on e.id = f.evidence_file_id
where f.status in ('accepted', 'edited');

grant select on public.fact_ledger_confirmed to authenticated;

-- Resolving one fact and recording it in the audit trail, as a single
-- transaction. This prompt's other acceptance criterion is "every
-- accept/edit/reject writes to audit_log" — a Supabase/PostgREST client
-- can't span two tables in one transaction, so doing this as an UPDATE
-- followed by a separate audit INSERT leaves a window where the status
-- changed and the log entry didn't. Here there is no window: one call,
-- one transaction, both rows or neither. lib/facts/resolve.ts's port
-- therefore has no separate "append audit" method for a caller to
-- forget — see docs/decisions.md.
--
-- security definer because it writes audit_log, which `authenticated`
-- can only insert rows into under its own append-only policy, and
-- because the before/after snapshots must be the row's real state rather
-- than anything the caller supplies. It is granted to `authenticated`
-- (not service_role) so that auth.uid() is the actual assessor — and it
-- checks is_staff() itself, since a security-definer function bypasses
-- the RLS on extracted_facts that would otherwise be doing that job.
create function public.resolve_extracted_fact(
  p_fact_id uuid,
  p_status text,
  p_resolved_value jsonb,
  p_rejection_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_actor uuid := auth.uid();
begin
  if not public.is_staff() then
    raise exception 'resolve_extracted_fact: only staff may resolve a fact';
  end if;

  if p_status not in ('accepted', 'edited', 'rejected') then
    raise exception 'resolve_extracted_fact: unsupported status %', p_status;
  end if;

  if p_status = 'edited' and p_resolved_value is null then
    raise exception 'resolve_extracted_fact: an edit needs a value';
  end if;

  if p_status = 'rejected' and coalesce(btrim(p_rejection_reason), '') = '' then
    raise exception 'resolve_extracted_fact: a rejection needs a reason';
  end if;

  select to_jsonb(f) into v_before from public.extracted_facts f where f.id = p_fact_id for update;
  if v_before is null then
    raise exception 'resolve_extracted_fact: no fact %', p_fact_id;
  end if;

  update public.extracted_facts
  set status = p_status,
      -- An edit stores the human's value here and leaves the model's own
      -- value_* columns untouched as provenance for verbatim_quote.
      resolved_value_json = case when p_status = 'edited' then p_resolved_value else null end,
      rejection_reason = case when p_status = 'rejected' then btrim(p_rejection_reason) else null end,
      resolved_by = v_actor,
      resolved_at = now(),
      updated_at = now()
  where id = p_fact_id;

  select to_jsonb(f) into v_after from public.extracted_facts f where f.id = p_fact_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    v_actor,
    case p_status when 'accepted' then 'fact.accept' when 'edited' then 'fact.edit' else 'fact.reject' end,
    'extracted_fact',
    p_fact_id::text,
    v_before,
    v_after
  );
end;
$$;

grant execute on function public.resolve_extracted_fact(uuid, text, jsonb, text) to authenticated;
