-- Configurable compliance scoring weights (this prompt): "Compliant 1.0,
-- Partial 0.5, Not Compliant 0, Not Applicable excluded" as an
-- admin-editable, versioned record — not the hardcoded constant
-- lib/rules/aggregate.ts carried before this migration. The exact
-- versioning shape (one active row, immutable once referenced,
-- superseded rather than edited) mirrors rule_definitions
-- (0022_rule_engine.sql) for the same reason: a report's percentages
-- have to stay reproducible from what's stored, so the weights that
-- produced them can never be silently rewritten out from under it.

create table public.scoring_weights (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  compliant_weight numeric not null,
  partial_weight numeric not null,
  not_compliant_weight numeric not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz
);

-- At most one active version at a time — same partial-unique-index shape
-- as rule_definitions_one_active_per_code, just with no code to key on
-- (there is only ever one global scoring-weights record).
create unique index scoring_weights_one_active
  on public.scoring_weights ((true))
  where active and deleted_at is null;

alter table public.scoring_weights enable row level security;

create policy "scoring_weights_select_staff" on public.scoring_weights
  for select to authenticated using (public.is_staff());

create policy "scoring_weights_write_admin" on public.scoring_weights
  for insert to authenticated with check (public.is_admin());

create policy "scoring_weights_update_admin" on public.scoring_weights
  for update to authenticated using (public.is_admin());

insert into public.scoring_weights (version, compliant_weight, partial_weight, not_compliant_weight)
values (1, 1.0, 0.5, 0);

-- Which weights version produced this report's Risk/Overall/Adjusted
-- figures — "record which was used on each report" (this prompt). Added
-- before scoring_weights_in_use() below, which reads it.
alter table public.reports add column scoring_weights_id uuid references public.scoring_weights (id);

-- A version referenced by a report is immutable except for `active` —
-- same reasoning, same shape, as rule_definitions_immutable_once_used.
create function public.scoring_weights_in_use(p_scoring_weights_id uuid) returns boolean
language sql stable
as $$
  select exists (select 1 from public.reports where scoring_weights_id = p_scoring_weights_id);
$$;

create function public.prevent_scoring_weights_mutation() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if public.scoring_weights_in_use(old.id) then
      raise exception 'scoring_weights % has been used on a report and cannot be deleted; supersede it with a new version instead', old.id;
    end if;
    return old;
  end if;

  if public.scoring_weights_in_use(old.id) and (
    old.version is distinct from new.version
    or old.compliant_weight is distinct from new.compliant_weight
    or old.partial_weight is distinct from new.partial_weight
    or old.not_compliant_weight is distinct from new.not_compliant_weight
  ) then
    raise exception 'scoring_weights % has been used on a report and is immutable except for active; create a new version instead', old.id;
  end if;

  return new;
end;
$$;

create trigger scoring_weights_immutable_once_used
  before update or delete on public.scoring_weights
  for each row execute function public.prevent_scoring_weights_mutation();

grant select on public.scoring_weights to authenticated;
grant insert, update on public.scoring_weights to authenticated;

-- === approve_assessment_and_generate_report gains the scoring
-- === weights + the computed Risk/Overall/Adjusted figures, stamping
-- === both the report row and the (until now, never-written)
-- === assessments.risk_rating/overall_compliance_pct/adjusted_compliance_pct
-- === columns in the same transaction. ===
drop function if exists public.approve_assessment_and_generate_report(uuid, text, jsonb, text);

create function public.approve_assessment_and_generate_report(
  p_assessment_id uuid,
  p_storage_path text,
  p_snapshot jsonb,
  p_format text,
  p_scoring_weights_id uuid,
  p_risk_rating text,
  p_overall_compliance_pct numeric,
  p_adjusted_compliance_pct numeric
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision integer;
  v_actor uuid := auth.uid();
  v_report_id uuid;
begin
  if not public.is_admin() then
    raise exception 'approve_assessment_and_generate_report: only an admin may approve an assessment';
  end if;

  select revision_number into v_revision from public.assessments where id = p_assessment_id for update;
  if v_revision is null then
    raise exception 'approve_assessment_and_generate_report: no assessment %', p_assessment_id;
  end if;

  update public.assessments
  set approval_status = 'approved',
      issued_at = coalesce(issued_at, now()),
      risk_rating = p_risk_rating,
      overall_compliance_pct = p_overall_compliance_pct,
      adjusted_compliance_pct = p_adjusted_compliance_pct
  where id = p_assessment_id;
  -- enforce_approval_transition raises here if approval_status wasn't
  -- 'awaiting_client' — nothing further below runs in that case.

  update public.assessment_items set locked = true where assessment_id = p_assessment_id;

  update public.reports set is_current = false where assessment_id = p_assessment_id and is_current;

  insert into public.reports (assessment_id, version, format, storage_path, snapshot, scoring_weights_id, generated_by, is_current)
  values (p_assessment_id, v_revision, p_format, p_storage_path, p_snapshot, p_scoring_weights_id, v_actor, true)
  returning id into v_report_id;

  return v_report_id;
end;
$$;

grant execute on function public.approve_assessment_and_generate_report(uuid, text, jsonb, text, uuid, text, numeric, numeric) to authenticated;
