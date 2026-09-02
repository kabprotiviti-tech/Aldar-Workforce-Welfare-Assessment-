-- Templates: versioned checklists. Reports must be reproducible against
-- the template version they were assessed under, so a template's
-- requirements/questions are meant to stay fixed once a template is
-- active and in use — new content ships as a new version, never an edit
-- to a published one. That's a process convention (documented here and in
-- docs/decisions.md), not something this migration enforces mechanically;
-- see there for why.

create function public.is_admin() returns boolean
language sql stable
as $$
  select public.current_user_role() = 'admin';
$$;

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('employment_practices', 'onboarding', 'accommodation')),
  version integer not null,
  effective_from date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  unique (module, version)
);

alter table public.checklist_templates enable row level security;

create policy "checklist_templates_select_staff" on public.checklist_templates
  for select to authenticated using (public.is_staff());

create policy "checklist_templates_write_admin" on public.checklist_templates
  for insert to authenticated with check (public.is_admin());

create policy "checklist_templates_update_admin" on public.checklist_templates
  for update to authenticated using (public.is_admin());

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates (id),
  sl_no integer not null,
  title text not null,
  is_key boolean not null default false,
  detail_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  unique (template_id, sl_no)
);

alter table public.requirements enable row level security;

create policy "requirements_select_staff" on public.requirements
  for select to authenticated using (public.is_staff());

create policy "requirements_write_admin" on public.requirements
  for insert to authenticated with check (public.is_admin());

create policy "requirements_update_admin" on public.requirements
  for update to authenticated using (public.is_admin());

-- answer_type has exactly one known value today (the fixed Yes/No/Unclear/
-- Not Applicable vocabulary from CONTEXT.md) but is left unconstrained
-- rather than guessing a full enum for question types that don't exist yet.
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements (id),
  code text not null,
  text text not null,
  answer_type text not null default 'yes_no_unclear_na',
  requires_quantitative boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  unique (requirement_id, code)
);

alter table public.questions enable row level security;

create policy "questions_select_staff" on public.questions
  for select to authenticated using (public.is_staff());

create policy "questions_write_admin" on public.questions
  for insert to authenticated with check (public.is_admin());

create policy "questions_update_admin" on public.questions
  for update to authenticated using (public.is_admin());
