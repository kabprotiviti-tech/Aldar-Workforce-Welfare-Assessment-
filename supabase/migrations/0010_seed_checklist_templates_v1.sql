-- Template version 1 for every module. Employment Practices and
-- Onboarding share the same 23 requirements (CONTEXT.md) but get their
-- own checklist_templates row each, since a template belongs to exactly
-- one module — so the same 23 titles/is_key flags are inserted twice,
-- once per module, deliberately, not shared by reference.
--
-- detail_text (the sub-clause text an assessor needs to see) is left
-- null here — it's real policy content that has to come from the client,
-- not be invented to fill the column. Same for the Accommodation
-- template's key questions (public.questions): no rows yet, pending that
-- content. See docs/decisions.md.

with req_data (sl_no, title, is_key) as (
  values
    (1, 'No discrimination', false),
    (2, 'No harassment', false),
    (3, 'Equal opportunity', false),
    (4, 'Fair disciplinary measures', false),
    (5, 'No forced labour', true),
    (6, 'No child labour', false),
    (7, 'Voluntary overtime', false),
    (8, 'No fees recruitment', true),
    (9, 'Contract transparency', false),
    (10, 'No retention of personal documents', true),
    (11, 'Timely wage payment', true),
    (12, 'Full wages and benefits', false),
    (13, 'Correct overtime remuneration', false),
    (14, 'Employer provided medical insurance', true),
    (15, 'Full leave benefits', false),
    (16, 'Legal working hours', true),
    (17, 'Health and safety at work', true),
    (18, 'Decent accommodation and food', true),
    (19, 'Safe transportation', true),
    (20, 'Clear grievance mechanisms', false),
    (21, 'Guarantee of legal rights', false),
    (22, 'Clear inductions', true),
    (23, 'Freedom of movement', false)
),
ep_template as (
  insert into public.checklist_templates (module, version, effective_from, is_active)
  values ('employment_practices', 1, current_date, true)
  returning id
)
insert into public.requirements (template_id, sl_no, title, is_key)
select ep_template.id, sl_no, title, is_key
from ep_template, req_data;

with req_data (sl_no, title, is_key) as (
  values
    (1, 'No discrimination', false),
    (2, 'No harassment', false),
    (3, 'Equal opportunity', false),
    (4, 'Fair disciplinary measures', false),
    (5, 'No forced labour', true),
    (6, 'No child labour', false),
    (7, 'Voluntary overtime', false),
    (8, 'No fees recruitment', true),
    (9, 'Contract transparency', false),
    (10, 'No retention of personal documents', true),
    (11, 'Timely wage payment', true),
    (12, 'Full wages and benefits', false),
    (13, 'Correct overtime remuneration', false),
    (14, 'Employer provided medical insurance', true),
    (15, 'Full leave benefits', false),
    (16, 'Legal working hours', true),
    (17, 'Health and safety at work', true),
    (18, 'Decent accommodation and food', true),
    (19, 'Safe transportation', true),
    (20, 'Clear grievance mechanisms', false),
    (21, 'Guarantee of legal rights', false),
    (22, 'Clear inductions', true),
    (23, 'Freedom of movement', false)
),
onboarding_template as (
  insert into public.checklist_templates (module, version, effective_from, is_active)
  values ('onboarding', 1, current_date, true)
  returning id
)
insert into public.requirements (template_id, sl_no, title, is_key)
select onboarding_template.id, sl_no, title, is_key
from onboarding_template, req_data;

-- Accommodation: 12 assessment areas. is_key doesn't apply here (that
-- distinction is an Employment Practices/Onboarding concept — see
-- docs/schema.md) so every row keeps the column's false default.
with area_data (sl_no, title) as (
  values
    (1, 'General requirements'),
    (2, 'Bedrooms'),
    (3, 'Bathrooms'),
    (4, 'Kitchens'),
    (5, 'Mess halls'),
    (6, 'Medical services'),
    (7, 'Laundry'),
    (8, 'Public health requirements'),
    (9, 'Accommodation management'),
    (10, 'Health safety and security'),
    (11, 'Utilities'),
    (12, 'Firefighting and alarm systems')
),
accommodation_template as (
  insert into public.checklist_templates (module, version, effective_from, is_active)
  values ('accommodation', 1, current_date, true)
  returning id
)
insert into public.requirements (template_id, sl_no, title)
select accommodation_template.id, sl_no, title
from accommodation_template, area_data;
