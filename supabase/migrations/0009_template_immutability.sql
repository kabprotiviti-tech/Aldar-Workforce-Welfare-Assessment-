-- Enforces, at the database level, what 0003_templates.sql's comment only
-- documented as a convention: once any assessment references a
-- checklist_template, that template and its requirements/questions are
-- frozen. New content ships as a new template version; nothing about an
-- existing one changes underneath assessments (and the reports generated
-- from them) that already point at it.
--
-- is_active is the one exception on checklist_templates itself — flipping
-- which version is current has to keep working after the old version is
-- in use, or there would be no way to retire it.

create function public.template_in_use(p_template_id uuid) returns boolean
language sql stable
as $$
  select exists (select 1 from public.assessments where template_id = p_template_id);
$$;

create function public.prevent_checklist_template_mutation() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if public.template_in_use(old.id) then
      raise exception 'checklist_templates % is referenced by an assessment and cannot be deleted; create a new version instead', old.id;
    end if;
    return old;
  end if;

  if public.template_in_use(old.id) and (
    old.module is distinct from new.module
    or old.version is distinct from new.version
    or old.effective_from is distinct from new.effective_from
    or old.deleted_at is distinct from new.deleted_at
  ) then
    raise exception 'checklist_templates % is referenced by an assessment and is immutable except for is_active; create a new version instead', old.id;
  end if;

  return new;
end;
$$;

create trigger checklist_templates_immutable_once_used
  before update or delete on public.checklist_templates
  for each row execute function public.prevent_checklist_template_mutation();

-- requirements: every column is substantive (there's no is_active-style
-- toggle) — any change, or adding a new requirement to an in-use
-- template, is blocked outright once that template has an assessment
-- against it.

create function public.prevent_requirement_mutation() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if public.template_in_use(new.template_id) then
      raise exception 'cannot add a requirement to checklist_template % — already referenced by an assessment; create a new template version instead', new.template_id;
    end if;
    return new;
  end if;

  if public.template_in_use(old.template_id) then
    raise exception 'requirement % belongs to a checklist_template already referenced by an assessment and is immutable; create a new template version instead', old.id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger requirements_immutable_once_used
  before insert or update or delete on public.requirements
  for each row execute function public.prevent_requirement_mutation();

-- questions: same rule, one hop further — resolve the requirement's
-- template_id and check that.

create function public.prevent_question_mutation() returns trigger
language plpgsql
as $$
declare
  v_template_id uuid;
begin
  if tg_op = 'INSERT' then
    select template_id into v_template_id from public.requirements where id = new.requirement_id;
    if public.template_in_use(v_template_id) then
      raise exception 'cannot add a question to requirement % — its checklist_template is already referenced by an assessment; create a new template version instead', new.requirement_id;
    end if;
    return new;
  end if;

  select template_id into v_template_id from public.requirements where id = old.requirement_id;
  if public.template_in_use(v_template_id) then
    raise exception 'question % belongs to a checklist_template already referenced by an assessment and is immutable; create a new template version instead', old.id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger questions_immutable_once_used
  before insert or update or delete on public.questions
  for each row execute function public.prevent_question_mutation();
