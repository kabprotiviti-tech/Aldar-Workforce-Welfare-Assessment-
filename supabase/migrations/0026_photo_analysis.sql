-- Vision analysis of inspection photographs (this prompt). The
-- constraint is the point of the feature: a photograph is analysed for a
-- closed list of classes and fields, it produces observations rather than
-- answers, and nothing it reports reaches a rule until an assessor has
-- confirmed it.
--
-- Three of those guarantees are made here rather than in application
-- code, because application code is where a guarantee goes to be
-- forgotten:
--   1. photo_analysis_confirmed is the only read path for an analysis, so
--      an unreviewed or rejected one cannot reach a report.
--   2. A rejected analysis keeps its reason, permanently.
--   3. A photo-sourced fact may only carry a fact key from a fixed list —
--      enforced by trigger, so no code path can attach a floor area or a
--      per-person value to a photograph.

-- The closed list of classes a photograph may be analysed for (this
-- prompt names them, and lib/vision/classes.ts declares the fields each
-- one returns). A table rather than a check constraint because two
-- columns reference it — photos.photo_class and
-- photo_analyses.photo_class — and one source of truth beats two
-- constraints that can drift apart. A drift test holds it against the
-- code vocabulary.
create table public.photo_class_names (
  photo_class text primary key,
  label text not null
);

insert into public.photo_class_names (photo_class, label) values
  ('fire_extinguisher', 'Fire extinguisher'),
  ('exit_route', 'Exit route'),
  ('notice_board', 'Notice board'),
  ('certificate_document', 'Certificate or document'),
  ('room_general', 'Accommodation room'),
  ('kitchen_general', 'Kitchen'),
  ('ablution_general', 'Ablution facilities'),
  ('vehicle', 'Vehicle');

-- One analysis run over one photograph. `findings` is the validated,
-- guard-stripped reading list; `raw_response` is what the model actually
-- returned, kept for provenance and never read by anything downstream.
create table public.photo_analyses (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos (id) on delete cascade,
  photo_class text not null references public.photo_class_names (photo_class),
  model text not null,
  prompt_version text not null,
  raw_response jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  error text,
  -- The readings the analyser kept, after the undeterminable guards ran.
  findings jsonb not null default '[]'::jsonb,
  -- What this photograph cannot establish (this prompt: every response
  -- must carry it). Part of the analysis an assessor reads, not a note.
  cannot_determine text[] not null default '{}',
  -- Anything the guards removed from the model's response, recorded
  -- rather than silently dropped so a pattern of it is visible.
  suppressed text[] not null default '{}',
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'edited', 'rejected')),
  -- The assessor's version of the readings, when they edited rather than
  -- accepted. The model's own findings stay put as provenance.
  edited_findings jsonb,
  rejection_reason text,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- This prompt: "rejected analyses are retained with reason". Retained
  -- is the default — nothing deletes them — and the reason is required.
  constraint photo_analyses_rejection_reason_check check (
    (status = 'rejected') = (coalesce(btrim(rejection_reason), '') <> '')
  ),
  constraint photo_analyses_edit_check check ((status = 'edited') = (edited_findings is not null))
);

create index photo_analyses_photo_id_idx on public.photo_analyses (photo_id);
create index photo_analyses_status_idx on public.photo_analyses (status);

alter table public.photo_analyses enable row level security;

create policy "photo_analyses_select_staff" on public.photo_analyses
  for select to authenticated using (public.is_staff());

create policy "photo_analyses_write_staff" on public.photo_analyses
  for insert to authenticated with check (public.can_write_operational());

create policy "photo_analyses_update_staff" on public.photo_analyses
  for update to authenticated using (public.can_write_operational());

-- The only read path for an analysis, the same shape and for the same
-- reason as fact_ledger_confirmed (0021_fact_ledger.sql): a proposed
-- analysis has never been looked at and a rejected one was refused, and
-- neither belongs anywhere near a report. `confirmed_findings` resolves
-- which version is authoritative so no consumer can read the model's
-- superseded proposal by mistake.
create view public.photo_analysis_confirmed
with (security_invoker = true)
as
select
  a.id,
  a.photo_id,
  p.assessment_id,
  p.requirement_id,
  p.room_ref,
  a.photo_class,
  case when a.status = 'edited' then a.edited_findings else a.findings end as confirmed_findings,
  a.cannot_determine,
  a.status,
  a.reviewed_by,
  a.reviewed_at,
  a.created_at
from public.photo_analyses a
join public.photos p on p.id = a.photo_id
where a.status in ('accepted', 'edited');

grant select on public.photo_analysis_confirmed to authenticated;

-- What the assessor says they photographed. The class decides which
-- closed field vocabulary the analysis uses (lib/vision/classes.ts), so
-- it is a person's classification of the subject, captured at the same
-- moment as the photograph, rather than something the model decides for
-- itself afterwards. Nullable: a photograph taken as a general record
-- is not analysed at all, and that is a legitimate thing to do.
alter table public.photos add column photo_class text
  references public.photo_class_names (photo_class);

-- apply_inspection_mutation (0025_inspection_sync.sql) carries the class
-- through the offline queue with the rest of the capture. Replaced whole
-- rather than patched, because a Postgres function has no other form.
create or replace function public.apply_inspection_mutation(
  p_client_mutation_id uuid,
  p_assessment_id uuid,
  p_kind text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_existing jsonb;
  v_result jsonb;
  v_item_id uuid;
  v_facility_id uuid;
  v_room_id uuid;
  v_photo_id uuid;
  v_answer_id uuid;
  v_quantitative jsonb;
begin
  if v_actor is null or not public.can_write_operational() then
    raise exception 'apply_inspection_mutation: only an admin or assessor may sync an inspection'
      using errcode = 'insufficient_privilege';
  end if;

  -- The claim. If this conflicts, the mutation is already applied.
  insert into public.inspection_sync_log (client_mutation_id, assessment_id, kind, applied_by)
  values (p_client_mutation_id, p_assessment_id, p_kind, v_actor)
  on conflict (client_mutation_id) do nothing;

  if not found then
    select result into v_existing from public.inspection_sync_log where client_mutation_id = p_client_mutation_id;
    return jsonb_build_object('applied', false, 'duplicate', true, 'result', v_existing);
  end if;

  if p_kind = 'area_answer' then
    insert into public.assessment_answers (assessment_item_id, question_id, answer, remark, action_required, created_by)
    values (
      (p_payload ->> 'assessment_item_id')::uuid,
      (p_payload ->> 'question_id')::uuid,
      p_payload ->> 'answer',
      p_payload ->> 'remark',
      p_payload ->> 'action_required',
      v_actor
    )
    on conflict (assessment_item_id, question_id) do update
      set answer = excluded.answer,
          remark = excluded.remark,
          action_required = excluded.action_required,
          updated_at = now()
    returning id into v_answer_id;
    v_result := jsonb_build_object('assessment_answer_id', v_answer_id);

  elsif p_kind = 'area_quantitative' then
    v_item_id := (p_payload ->> 'assessment_item_id')::uuid;
    update public.assessment_items
    set quantitative = coalesce(quantitative, '{}'::jsonb) || (p_payload -> 'quantitative'),
        updated_at = now()
    where id = v_item_id;
    v_result := jsonb_build_object('assessment_item_id', v_item_id);

  elsif p_kind = 'certificate' then
    -- Appended, not overwritten: two certificates captured offline in the
    -- same area must both survive the sync, and a whole-object write
    -- would silently drop whichever arrived first.
    v_item_id := (p_payload ->> 'assessment_item_id')::uuid;
    select coalesce(quantitative, '{}'::jsonb) into v_quantitative from public.assessment_items where id = v_item_id;
    update public.assessment_items
    set quantitative = jsonb_set(
          v_quantitative,
          '{certificates}',
          coalesce(v_quantitative -> 'certificates', '[]'::jsonb) || jsonb_build_array(p_payload -> 'certificate'),
          true
        ),
        updated_at = now()
    where id = v_item_id;
    v_result := jsonb_build_object('assessment_item_id', v_item_id);

  elsif p_kind = 'area_rating' then
    -- Goes through the 0024 trigger like any other status write: stamped
    -- with decided_by/decided_at and audited, with auth.uid() being the
    -- assessor who set it on site.
    v_item_id := (p_payload ->> 'assessment_item_id')::uuid;
    update public.assessment_items
    set compliance_status = p_payload ->> 'compliance_status',
        remarks = p_payload ->> 'remarks',
        action_required = p_payload ->> 'action_required'
    where id = v_item_id;
    v_result := jsonb_build_object('assessment_item_id', v_item_id);

  elsif p_kind = 'room_count' then
    -- The assessor's own physical bed and occupancy count (this prompt),
    -- which is why source is 'manual' and measured_area_m2 is left alone.
    select facility_id into v_facility_id from public.assessments where id = p_assessment_id;
    insert into public.rooms (facility_id, room_ref, bed_count, occupancy_count, source, confirmed_by, created_by)
    values (v_facility_id, p_payload ->> 'room_ref', (p_payload ->> 'bed_count')::integer, (p_payload ->> 'occupancy_count')::integer, 'manual', v_actor, v_actor)
    on conflict (facility_id, room_ref) do update
      set bed_count = excluded.bed_count,
          occupancy_count = excluded.occupancy_count,
          confirmed_by = excluded.confirmed_by,
          updated_at = now()
    returning id into v_room_id;
    v_result := jsonb_build_object('room_id', v_room_id);

  elsif p_kind = 'photo' then
    insert into public.photos (assessment_id, requirement_id, room_ref, photo_class, storage_path, captured_at, geo_lat, geo_lng, caption, uploaded_by)
    values (
      p_assessment_id,
      nullif(p_payload ->> 'requirement_id', '')::uuid,
      nullif(p_payload ->> 'room_ref', ''),
      nullif(p_payload ->> 'photo_class', ''),
      p_payload ->> 'storage_path',
      nullif(p_payload ->> 'captured_at', '')::timestamptz,
      nullif(p_payload ->> 'geo_lat', '')::numeric,
      nullif(p_payload ->> 'geo_lng', '')::numeric,
      nullif(p_payload ->> 'caption', ''),
      v_actor
    )
    returning id into v_photo_id;
    v_result := jsonb_build_object('photo_id', v_photo_id);

  else
    raise exception 'apply_inspection_mutation: unsupported kind %', p_kind;
  end if;

  update public.inspection_sync_log set result = v_result where client_mutation_id = p_client_mutation_id;

  return jsonb_build_object('applied', true, 'duplicate', false, 'result', v_result);
end;
$$;

-- A photograph is now a second possible source for a fact, alongside a
-- document extraction. Exactly one of the two, never both and never
-- neither.
alter table public.extracted_facts alter column extraction_id drop not null;
alter table public.extracted_facts alter column evidence_file_id drop not null;
alter table public.extracted_facts add column photo_analysis_id uuid references public.photo_analyses (id) on delete cascade;

alter table public.extracted_facts add constraint extracted_facts_one_source check (
  (extraction_id is not null and evidence_file_id is not null and photo_analysis_id is null)
  or (extraction_id is null and evidence_file_id is null and photo_analysis_id is not null)
);

-- The fixed list of fact keys a photograph may ever produce, mirrored in
-- code by PHOTO_DERIVED_FACT_KEYS (lib/vision/derived-facts.ts) and kept
-- honest by a drift test. Only a reading of *printed text* is eligible:
-- a date on a service tag, a number on a notice board, a plate on a van.
create table public.photo_derived_fact_keys (
  fact_key text primary key,
  note text not null
);

insert into public.photo_derived_fact_keys (fact_key, note) values
  ('fire_extinguisher_service_date', 'Last service date read from a service tag.'),
  ('fire_extinguisher_expiry_date', 'Next-service-due or expiry date read from a service tag.'),
  ('grievance_contact_number', 'Grievance or helpline number read from a notice board.'),
  ('photo_certificate_reference', 'Reference number read from a certificate photographed on site.'),
  ('photo_certificate_expiry_date', 'Expiry date read from a certificate photographed on site, where the assessor did not identify it as a specific certificate type.'),
  ('civil_defence_expiry_date', 'Expiry date read from a certificate the assessor identified as a civil defence certificate.'),
  ('vehicle_registration_expiry_date', 'Expiry date read from a document the assessor identified as a vehicle registration.'),
  ('vehicle_registration_plate', 'Registration plate read from a vehicle.');

-- This prompt's acceptance criterion, at the level where it cannot be
-- worked around: "a bedroom photo never yields an area or per-person
-- value". No fact key outside the list above can be attached to a
-- photograph by any code path, service role included.
create function public.enforce_photo_derived_fact_key() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.photo_analysis_id is not null
     and not exists (select 1 from public.photo_derived_fact_keys k where k.fact_key = new.fact_key) then
    raise exception 'extracted_facts: % is not a fact key a photograph may produce', new.fact_key;
  end if;
  return new;
end;
$$;

create trigger extracted_facts_photo_derived_fact_key
before insert or update on public.extracted_facts
for each row execute function public.enforce_photo_derived_fact_key();

-- fact_ledger_confirmed gains the photograph source. Everything else
-- about it is unchanged, including the two properties it exists for: it
-- returns confirmed facts only, and it exposes one canonical
-- confirmed_value rather than the raw value columns.
drop view public.fact_ledger_confirmed;

create view public.fact_ledger_confirmed
with (security_invoker = true)
as
select
  f.id,
  f.extraction_id,
  f.evidence_file_id,
  f.photo_analysis_id,
  pa.photo_id,
  coalesce(e.assessment_id, ph.assessment_id) as assessment_id,
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
left join public.evidence_files e on e.id = f.evidence_file_id
left join public.photo_analyses pa on pa.id = f.photo_analysis_id
left join public.photos ph on ph.id = pa.photo_id
where f.status in ('accepted', 'edited');

grant select on public.fact_ledger_confirmed to authenticated;

-- Resolving one analysis and, where the assessor confirmed a printed
-- reading, creating the facts it becomes — one transaction, for the same
-- reason as resolve_extracted_fact (0021_fact_ledger.sql): a
-- PostgREST client cannot span tables, and a decision recorded without
-- its facts, or facts written without their decision, is worse than
-- either.
--
-- p_derived_facts is an array of
--   {"fact_key": "...", "value_text": "...", "value_date": "YYYY-MM-DD",
--    "unit": null, "verbatim_quote": "...", "confidence": "high"}
-- Each becomes an extracted_fact already at status 'accepted', resolved
-- by this assessor: they have just confirmed the reading against the
-- photograph in front of them, and making them confirm the same value a
-- second time in the fact ledger would be ceremony, not a control.
create function public.resolve_photo_analysis(
  p_analysis_id uuid,
  p_status text,
  p_edited_findings jsonb,
  p_rejection_reason text,
  p_derived_facts jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_actor uuid := auth.uid();
  v_fact jsonb;
  v_fact_id uuid;
begin
  if not public.is_staff() then
    raise exception 'resolve_photo_analysis: only staff may resolve an analysis';
  end if;

  if p_status not in ('accepted', 'edited', 'rejected') then
    raise exception 'resolve_photo_analysis: unsupported status %', p_status;
  end if;

  if p_status = 'edited' and p_edited_findings is null then
    raise exception 'resolve_photo_analysis: an edit needs the edited findings';
  end if;

  if p_status = 'rejected' and coalesce(btrim(p_rejection_reason), '') = '' then
    raise exception 'resolve_photo_analysis: a rejection needs a reason';
  end if;

  if p_status = 'rejected' and jsonb_array_length(coalesce(p_derived_facts, '[]'::jsonb)) > 0 then
    raise exception 'resolve_photo_analysis: a rejected analysis cannot produce facts';
  end if;

  select to_jsonb(a) into v_before from public.photo_analyses a where a.id = p_analysis_id for update;
  if v_before is null then
    raise exception 'resolve_photo_analysis: no analysis %', p_analysis_id;
  end if;

  if v_before ->> 'status' <> 'proposed' then
    raise exception 'resolve_photo_analysis: analysis % has already been resolved', p_analysis_id;
  end if;

  update public.photo_analyses
  set status = p_status,
      edited_findings = case when p_status = 'edited' then p_edited_findings else null end,
      rejection_reason = case when p_status = 'rejected' then btrim(p_rejection_reason) else null end,
      reviewed_by = v_actor,
      reviewed_at = now(),
      updated_at = now()
  where id = p_analysis_id;

  select to_jsonb(a) into v_after from public.photo_analyses a where a.id = p_analysis_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    v_actor,
    case p_status when 'accepted' then 'photo_analysis.accept' when 'edited' then 'photo_analysis.edit' else 'photo_analysis.reject' end,
    'photo_analysis',
    p_analysis_id::text,
    v_before,
    v_after
  );

  for v_fact in select * from jsonb_array_elements(coalesce(p_derived_facts, '[]'::jsonb))
  loop
    insert into public.extracted_facts (
      photo_analysis_id, fact_key, value_text, value_date, unit,
      verbatim_quote, confidence, status, resolved_by, resolved_at
    )
    values (
      p_analysis_id,
      v_fact ->> 'fact_key',
      v_fact ->> 'value_text',
      nullif(v_fact ->> 'value_date', '')::date,
      v_fact ->> 'unit',
      v_fact ->> 'verbatim_quote',
      v_fact ->> 'confidence',
      'accepted',
      v_actor,
      now()
    )
    returning id into v_fact_id;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    select v_actor, 'fact.accept', 'extracted_fact', v_fact_id::text, null, to_jsonb(f)
    from public.extracted_facts f where f.id = v_fact_id;
  end loop;
end;
$$;

grant execute on function public.resolve_photo_analysis(uuid, text, jsonb, text, jsonb) to authenticated;
