-- The on-site inspection (this prompt): a phone, in a labour
-- accommodation, on poor signal. Everything below exists to make
-- "reconnect and everything syncs exactly once with no duplicates" true
-- of a queue that was written offline and may be replayed any number of
-- times.

-- Which room a photo is of, where that's relevant (this prompt). Free
-- text matching rooms.room_ref rather than an FK: a photo is often taken
-- before the room row exists, and a photo that can't be saved because a
-- room hasn't been created yet is a photo lost on site.
alter table public.photos add column room_ref text;

-- ---------------------------------------------------------------------------
-- Exactly-once sync
-- ---------------------------------------------------------------------------

-- Every queued mutation carries a client-generated id, created on the
-- phone when the assessor takes the action — not when it syncs. That id
-- is the primary key here, so a replay (a retry, a double tap, a
-- half-finished sync resumed after the tunnel) inserts nothing and
-- applies nothing.
--
-- A log table rather than a unique column per target table, because the
-- mutations aren't all inserts: a quantitative capture updates a row that
-- already exists, and has no natural per-mutation row of its own to hang
-- a constraint on.
create table public.inspection_sync_log (
  client_mutation_id uuid primary key,
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  kind text not null check (kind in ('area_answer', 'area_quantitative', 'area_rating', 'room_count', 'photo', 'certificate')),
  applied_at timestamptz not null default now(),
  applied_by uuid references auth.users (id),
  /** What the mutation produced — the row it created, for the client to reconcile against. */
  result jsonb
);

create index inspection_sync_log_assessment_idx on public.inspection_sync_log (assessment_id, applied_at desc);

alter table public.inspection_sync_log enable row level security;

create policy "inspection_sync_log_select_staff" on public.inspection_sync_log
  for select to authenticated using (public.is_staff());

grant select on public.inspection_sync_log to authenticated;

/**
 * Applies one queued mutation, exactly once.
 *
 * The claim and the work are one transaction: the log row is inserted
 * first with `on conflict do nothing`, and if that inserted nothing the
 * mutation has already been applied and this returns the original result
 * without touching anything. There is no window in which a mutation is
 * applied but unrecorded, or recorded but unapplied — which is precisely
 * what "syncs exactly once with no duplicates" requires of a client that
 * may retry at any point.
 *
 * security definer so the log write is guaranteed, with an explicit
 * is_staff()/can_write_operational() check inside — the same pattern as
 * resolve_extracted_fact (0021). auth.uid() is the real assessor, which
 * matters: an area rating is a compliance status, and the trigger from
 * 0024 stamps and audits it exactly as if it had been set at a desk.
 */
create function public.apply_inspection_mutation(
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
    insert into public.photos (assessment_id, requirement_id, room_ref, storage_path, captured_at, geo_lat, geo_lng, caption, uploaded_by)
    values (
      p_assessment_id,
      nullif(p_payload ->> 'requirement_id', '')::uuid,
      nullif(p_payload ->> 'room_ref', ''),
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

grant execute on function public.apply_inspection_mutation(uuid, uuid, text, jsonb) to authenticated;
