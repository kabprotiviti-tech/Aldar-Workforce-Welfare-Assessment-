-- Drawing-based room area, with a hard separation between extraction
-- and calculation (this prompt). A drawing's printed numbers reach
-- extracted_facts exactly as printed; every conversion and every
-- multiplication happens in code (lib/rooms/units.ts,
-- lib/rooms/area-calc.ts); and a computed m² per resident can exist only
-- once a person has confirmed both the area and the occupancy it was
-- computed from.

-- Which entry (a room on a drawing, a row on an occupancy schedule) one
-- fact belongs to, for a document that lists many of the same kind of
-- thing. Set once, at extraction time, to that entry's own printed
-- label — never touched by a later edit to the fact's own value — so
-- grouping the six facts a drawing reports per room stays correct after
-- an assessor accepts, edits or rejects them individually and out of
-- order (lib/rooms/group-facts.ts). Null means "this fact is about the
-- whole document", which is what every fact key before this feature
-- still means.
alter table public.extracted_facts add column group_ref text;

-- fact_ledger_confirmed gains group_ref. Recreated whole, as it was for
-- the photograph source (0026_photo_analysis.sql) — the two guarantees
-- it exists for are unchanged: confirmed statuses only, one canonical
-- confirmed_value.
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
  f.group_ref,
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

-- Room-level confirmation. Rooms already stored drawing_area_m2 and
-- occupancy_count (0006_rules_measurement.sql) but nothing wrote them
-- and nothing gated computed_m2_per_person on a person having looked at
-- either value. This prompt's own acceptance criterion — "no m² per
-- person value can exist without a confirmed area AND a confirmed
-- occupancy" — is what these columns and the rebuilt generated column
-- below exist to guarantee.
alter table public.rooms add column area_confirmed_at timestamptz;
alter table public.rooms add column area_confirmed_by uuid references auth.users (id);
-- Set when a candidate area was computed from the drawing but withheld
-- from area_confirmed_at because its confidence was low (this prompt:
-- "on low confidence, present a manual entry field rather than a
-- guess"). Lets the review screen distinguish "the drawing didn't
-- mention this room" from "the drawing did, but we can't trust the
-- reading" — the same room, two different manual-entry prompts.
alter table public.rooms add column drawing_area_low_confidence boolean not null default false;

alter table public.rooms add column occupancy_confirmed_at timestamptz;
alter table public.rooms add column occupancy_confirmed_by uuid references auth.users (id);
-- Which of the two permitted sources occupancy_count currently is (this
-- prompt: "occupancy comes from the assessor's on-site bed/occupant
-- count, or from the occupancy schedule"). Written by whichever action
-- set occupancy_count, never inferred after the fact.
alter table public.rooms add column occupancy_source text check (occupancy_source in ('physical_count', 'schedule'));
-- The occupancy schedule's own confirmed figure for this room, kept
-- independently of occupancy_count so a schedule reading can be
-- reconciled against a physical count without either one silently
-- overwriting the other (ACM_OCCUPANCY_RECONCILED,
-- lib/rules/compliance/rules/accommodation.ts). Refreshed every time
-- lib/rooms/propose.ts re-reads the confirmed facts; never itself "the"
-- occupancy until an assessor promotes it via
-- confirm_room_occupancy_from_schedule.
alter table public.rooms add column schedule_occupancy_headcount integer;

-- Rebuilding computed_m2_per_person: Postgres has no ALTER COLUMN for a
-- stored generated column's expression, so the column is dropped and
-- re-added — it recomputes from the table's current data either way,
-- since a generated column has no independent storage a drop could lose.
alter table public.rooms drop column computed_m2_per_person;
alter table public.rooms add column computed_m2_per_person numeric generated always as (
  case
    when area_confirmed_at is null or occupancy_confirmed_at is null then null
    when occupancy_count is null or occupancy_count = 0 then null
    else coalesce(measured_area_m2, drawing_area_m2) / occupancy_count
  end
) stored;

-- Confirming or overriding a room's drawing-derived area, and recording
-- the decision — one transaction, the same reasoning as
-- resolve_extracted_fact (0021_fact_ledger.sql) and
-- resolve_photo_analysis (0026_photo_analysis.sql): a source label
-- ("drawing", "manual", "both" — rooms.source, 0006_rules_measurement.sql)
-- set without an audit row, or an audit row without the field it
-- describes, is worse than either.
create function public.resolve_room_area(
  p_room_id uuid,
  p_action text,
  p_measured_area_m2 numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_actor uuid := auth.uid();
  v_drawing_area numeric;
begin
  if not public.is_staff() then
    raise exception 'resolve_room_area: only staff may confirm a room''s area';
  end if;

  if p_action not in ('confirm', 'override') then
    raise exception 'resolve_room_area: unsupported action %', p_action;
  end if;

  select to_jsonb(r) into v_before from public.rooms r where r.id = p_room_id for update;
  if v_before is null then
    raise exception 'resolve_room_area: no room %', p_room_id;
  end if;

  v_drawing_area := (v_before ->> 'drawing_area_m2')::numeric;

  if p_action = 'confirm' then
    if v_drawing_area is null then
      raise exception 'resolve_room_area: no drawing-derived area to confirm for room %', p_room_id;
    end if;
    update public.rooms
    set area_confirmed_at = now(),
        area_confirmed_by = v_actor,
        source = 'drawing',
        updated_at = now()
    where id = p_room_id;
  else
    if p_measured_area_m2 is null or p_measured_area_m2 <= 0 then
      raise exception 'resolve_room_area: an override needs a positive measured area';
    end if;
    update public.rooms
    set measured_area_m2 = p_measured_area_m2,
        area_confirmed_at = now(),
        area_confirmed_by = v_actor,
        source = case when v_drawing_area is not null then 'both' else 'manual' end,
        updated_at = now()
    where id = p_room_id;
  end if;

  select to_jsonb(r) into v_after from public.rooms r where r.id = p_room_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    v_actor,
    case p_action when 'confirm' then 'room.area_confirm' else 'room.area_override' end,
    'room',
    p_room_id::text,
    v_before,
    v_after
  );
end;
$$;

grant execute on function public.resolve_room_area(uuid, text, numeric) to authenticated;

-- Promoting the occupancy schedule's confirmed figure to be the room's
-- occupancy of record, for a room with no physical count of its own.
create function public.confirm_room_occupancy_from_schedule(
  p_room_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_actor uuid := auth.uid();
  v_schedule integer;
begin
  if not public.is_staff() then
    raise exception 'confirm_room_occupancy_from_schedule: only staff may confirm a room''s occupancy';
  end if;

  select to_jsonb(r) into v_before from public.rooms r where r.id = p_room_id for update;
  if v_before is null then
    raise exception 'confirm_room_occupancy_from_schedule: no room %', p_room_id;
  end if;

  v_schedule := (v_before ->> 'schedule_occupancy_headcount')::integer;
  if v_schedule is null then
    raise exception 'confirm_room_occupancy_from_schedule: no occupancy schedule figure for room %', p_room_id;
  end if;

  update public.rooms
  set occupancy_count = v_schedule,
      occupancy_source = 'schedule',
      occupancy_confirmed_at = now(),
      occupancy_confirmed_by = v_actor,
      updated_at = now()
  where id = p_room_id;

  select to_jsonb(r) into v_after from public.rooms r where r.id = p_room_id;

  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (v_actor, 'room.occupancy_confirm_schedule', 'room', p_room_id::text, v_before, v_after);
end;
$$;

grant execute on function public.confirm_room_occupancy_from_schedule(uuid) to authenticated;

-- The on-site physical count (apply_inspection_mutation's room_count
-- branch, 0025/0026) is itself the confirmation — an assessor standing
-- in the room and counting beds needs no further review step. Stamping
-- occupancy_confirmed_at/by/source here is what makes that count usable
-- by computed_m2_per_person and by ACM_OCCUPANCY_RECONCILED. Replaced
-- whole, as it was for the photograph class (0026) — a Postgres function
-- has no other form.
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
    v_item_id := (p_payload ->> 'assessment_item_id')::uuid;
    update public.assessment_items
    set compliance_status = p_payload ->> 'compliance_status',
        remarks = p_payload ->> 'remarks',
        action_required = p_payload ->> 'action_required'
    where id = v_item_id;
    v_result := jsonb_build_object('assessment_item_id', v_item_id);

  elsif p_kind = 'room_count' then
    -- The assessor's own physical bed and occupancy count. Stamping the
    -- occupancy confirmation here — rather than requiring a second,
    -- separate "confirm" action for a number the assessor just counted
    -- themselves — is what feeds it to computed_m2_per_person and to
    -- ACM_OCCUPANCY_RECONCILED at all.
    select facility_id into v_facility_id from public.assessments where id = p_assessment_id;
    insert into public.rooms (
      facility_id, room_ref, bed_count, occupancy_count, occupancy_source,
      occupancy_confirmed_at, occupancy_confirmed_by, source, confirmed_by, created_by
    )
    values (
      v_facility_id, p_payload ->> 'room_ref', (p_payload ->> 'bed_count')::integer, (p_payload ->> 'occupancy_count')::integer,
      'physical_count', now(), v_actor, 'manual', v_actor, v_actor
    )
    on conflict (facility_id, room_ref) do update
      set bed_count = excluded.bed_count,
          occupancy_count = excluded.occupancy_count,
          occupancy_source = 'physical_count',
          occupancy_confirmed_at = now(),
          occupancy_confirmed_by = excluded.occupancy_confirmed_by,
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

-- ACM_OCCUPANCY_RECONCILED — the 14th v1 rule, seeded the same way as
-- the other 13 (0022_rule_engine.sql). A standalone insert rather than
-- an edit to that migration: migrations are never rewritten once
-- applied (0009's own immutability principle, applied to itself).
with rule_seed (code, module, sl_no, title, description, input_fact_keys, quantitative_keys, threshold, legal_reference, explanation_template) as (
  values
    (
      'ACM_OCCUPANCY_RECONCILED', 'employment_practices', 18,
      'On-site occupancy count matches the occupancy schedule',
      'A room''s occupancy as counted on site is compared against the occupancy schedule; the two must not disagree.',
      array[]::text[], array['room_occupancy_physical', 'room_occupancy_schedule'],
      '{"maxAllowedDifference": 0}',
      'WWAP checklist requirement 18 (Decent accommodation and food). Data-reconciliation check between two recorded occupancy figures, not itself a statutory ratio.',
      '{physical} residents counted on site; {schedule} recorded on the occupancy schedule. {difference}. Maximum allowed difference {maxDifference}. {verdict}.'
    )
)
insert into public.rule_definitions (
  code, module, requirement_id, title, description,
  input_fact_keys, quantitative_keys, threshold, legal_reference, explanation_template, version, active
)
select
  s.code, s.module, r.id, s.title, s.description,
  s.input_fact_keys, s.quantitative_keys, s.threshold::jsonb, s.legal_reference, s.explanation_template, 1, true
from rule_seed s
join public.checklist_templates t on t.module = s.module and t.is_active and t.deleted_at is null
join public.requirements r on r.template_id = t.id and r.sl_no = s.sl_no and r.deleted_at is null;

-- Writing computed room-area/occupancy-schedule proposals in one place,
-- so "never overwrite a value a person has already confirmed" is a
-- property of the write itself rather than something every caller has
-- to remember (lib/rooms/propose.ts does the grouping and the
-- arithmetic; this is the only thing allowed to persist the result).
-- schedule_occupancy_headcount is always overwritten, confirmed value or
-- not — it is informational until confirm_room_occupancy_from_schedule
-- promotes it, so a re-run correctly clears it if the underlying fact
-- was since rejected.
--
-- p_proposals is a jsonb array of
--   {"room_ref": "...", "drawing_area_m2": 26.4 | null,
--    "low_confidence": true | false,
--    "schedule_occupancy_headcount": 8 | null}
create function public.propose_room_measurements(
  p_facility_id uuid,
  p_drawing_source_file_id uuid,
  p_proposals jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_proposal jsonb;
  v_count integer := 0;
begin
  if not public.can_write_operational() then
    raise exception 'propose_room_measurements: only staff may propose room measurements';
  end if;

  for v_proposal in select * from jsonb_array_elements(p_proposals)
  loop
    insert into public.rooms (facility_id, room_ref, created_by)
    values (p_facility_id, v_proposal ->> 'room_ref', v_actor)
    on conflict (facility_id, room_ref) do nothing;

    update public.rooms
    set drawing_area_m2 = case when area_confirmed_at is null then (v_proposal ->> 'drawing_area_m2')::numeric else drawing_area_m2 end,
        drawing_source_file_id = case when area_confirmed_at is null then p_drawing_source_file_id else drawing_source_file_id end,
        drawing_area_low_confidence = case when area_confirmed_at is null then coalesce((v_proposal ->> 'low_confidence')::boolean, false) else drawing_area_low_confidence end,
        schedule_occupancy_headcount = (v_proposal ->> 'schedule_occupancy_headcount')::integer,
        updated_at = now()
    where facility_id = p_facility_id and room_ref = v_proposal ->> 'room_ref';

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.propose_room_measurements(uuid, uuid, jsonb) to authenticated;
