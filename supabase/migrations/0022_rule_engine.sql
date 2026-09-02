-- The compliance rule engine's reference data (this prompt): thresholds
-- that "live in rule_definitions with a legal_reference string and are
-- editable by an admin, versioned, and stamped onto each evaluation", and
-- evaluations that are "stored, not recomputed on read, so a report is
-- reproducible".
--
-- 0006_rules_measurement.sql created both tables before there was a rule
-- engine to fill them. This adds what versioning and stamping need.

-- ---------------------------------------------------------------------------
-- rule_definitions: versioned, with the rule's declared shape alongside it
-- ---------------------------------------------------------------------------

alter table public.rule_definitions add column version integer not null default 1;
alter table public.rule_definitions add column title text;
-- The human-readable explanation template the rule renders its working
-- into. Stored so an admin can see the wording a rule will produce; the
-- rendering itself is done by the typed function in
-- lib/rules/compliance/rules/, which owns the tokens it fills.
alter table public.rule_definitions add column explanation_template text;
-- The assessor-entered fields a rule reads, alongside input_fact_keys
-- (which are read from fact_ledger_confirmed).
alter table public.rule_definitions add column quantitative_keys text[] not null default '{}';

-- A versioned definition can't have a unique code. rule_evaluations.rule_code
-- referenced that unique constraint; the evaluation now stamps the exact
-- definition row instead (see below), which is strictly more precise —
-- rule_code alone couldn't say *which version* produced a result.
alter table public.rule_evaluations drop constraint rule_evaluations_rule_code_fkey;
alter table public.rule_definitions drop constraint rule_definitions_code_key;
alter table public.rule_definitions add constraint rule_definitions_code_version_key unique (code, version);

-- Exactly one version of a rule is current at a time. A partial unique
-- index rather than a check constraint because the condition spans rows.
create unique index rule_definitions_one_active_per_code
  on public.rule_definitions (code)
  where active and deleted_at is null;

-- ---------------------------------------------------------------------------
-- rule_evaluations: stamped with everything needed to reproduce the result
-- ---------------------------------------------------------------------------

-- Which definition row — and therefore which version — produced this
-- result. Plus a copy of the threshold and citation actually used: the
-- FK alone would be enough while definitions stay immutable, but a
-- report has to be reproducible from the evaluation row on its own.
alter table public.rule_evaluations add column rule_definition_id uuid references public.rule_definitions (id);
alter table public.rule_evaluations add column rule_version integer;
alter table public.rule_evaluations add column thresholds jsonb;
alter table public.rule_evaluations add column legal_reference text;

-- The values the rule actually used, and the inputs it was given
-- (`inputs`, from 0006). Both are kept: `inputs` is what was available,
-- `observed` is what the arithmetic ran on.
alter table public.rule_evaluations add column observed jsonb;

-- insufficient_data is a first-class result (this prompt), and naming the
-- inputs that were absent is what makes it actionable rather than just a
-- shrug. Empty for pass and fail.
alter table public.rule_evaluations add column missing_fact_keys text[] not null default '{}';

-- Which specific thing was evaluated, when one rule runs many times for
-- one requirement: room "A-101", vehicle "AD-12345". Null when the rule
-- evaluates the assessment item as a whole.
alter table public.rule_evaluations add column subject_ref text;

alter table public.rule_evaluations add column evaluated_by uuid references auth.users (id);

create index rule_evaluations_item_rule_idx on public.rule_evaluations (assessment_item_id, rule_code, evaluated_at desc);

-- ---------------------------------------------------------------------------
-- A definition in use is immutable; an edit is a new version
-- ---------------------------------------------------------------------------

-- Same reasoning as 0009_template_immutability.sql for checklist
-- templates: an evaluation stamped with a threshold must keep meaning
-- what it meant. Editing a threshold in place would silently rewrite the
-- basis of every past result that points at it. `active` stays editable
-- so a new version can supersede this one.
create function public.rule_definition_in_use(p_definition_id uuid) returns boolean
language sql stable
as $$
  select exists (select 1 from public.rule_evaluations where rule_definition_id = p_definition_id);
$$;

create function public.prevent_rule_definition_mutation() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if public.rule_definition_in_use(old.id) then
      raise exception 'rule_definitions % has been used in an evaluation and cannot be deleted; supersede it with a new version instead', old.id;
    end if;
    return old;
  end if;

  if public.rule_definition_in_use(old.id) and (
    old.code is distinct from new.code
    or old.version is distinct from new.version
    or old.module is distinct from new.module
    or old.requirement_id is distinct from new.requirement_id
    or old.threshold is distinct from new.threshold
    or old.legal_reference is distinct from new.legal_reference
    or old.explanation_template is distinct from new.explanation_template
    or old.input_fact_keys is distinct from new.input_fact_keys
    or old.quantitative_keys is distinct from new.quantitative_keys
  ) then
    raise exception 'rule_definitions % has been used in an evaluation and is immutable except for active; create a new version instead', old.id;
  end if;

  return new;
end;
$$;

create trigger rule_definitions_immutable_once_used
  before update or delete on public.rule_definitions
  for each row execute function public.prevent_rule_definition_mutation();

-- ---------------------------------------------------------------------------
-- Seed: version 1 of every rule in this prompt's list
-- ---------------------------------------------------------------------------

-- Thresholds are seeded here as well as declared in
-- lib/rules/compliance/rules/ — the table is where they *live* and what
-- an admin edits, the code carries the same values as its fallback.
-- tests/db/rule-engine.test.ts fails if the two ever disagree.
--
-- Every legal_reference below names the WWAP checklist requirement, which
-- is the reference we actually have, and is marked PENDING VERIFICATION
-- where the statutory citation has not been confirmed. Inventing article
-- numbers to fill the column would put fabricated law in front of a
-- client. See docs/decisions.md.
--
-- requirement_id is resolved by (module, sl_no) against the active
-- template: the rule codes match the checklist's own numbering (R11 ->
-- requirement 11, "Timely wage payment").
with rule_seed (code, module, sl_no, title, description, input_fact_keys, quantitative_keys, threshold, legal_reference, explanation_template) as (
  values
    (
      'R08_AGENCY_CLAUSE', 'employment_practices', 8,
      'Employer-pays clause on every recruitment agency agreement',
      'Every agency agreement must carry a clause placing recruitment costs on the employer.',
      array['agency_employer_pays_clause_present', 'agency_name'], array['agency_agreements'],
      '{"requireOnEveryAgreement": true}',
      'WWAP checklist requirement 8 (No fees recruitment); employer-pays principle. PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      '{checked} checked: employer-pays clause present on {presentCount}, absent on {absentCount}{absentDetail}. {requirementPhrase}. {verdict}.'
    ),
    (
      'R10_DOC_RETURN', 'employment_practices', 10,
      'Personal documents returned within the time limit',
      'A retained passport must be returned within 24 hours of a request, or 6 hours in an emergency.',
      array['passport_return_hours'], array['passport_return_context'],
      '{"maxHoursNormal": 24, "maxHoursEmergency": 6}',
      'WWAP checklist requirement 10 (No retention of personal documents). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'Passport returned {hours} hours after a {context} request. Limit for a {context} request is {limit} hours. {verdict}.'
    ),
    (
      'R11_WAGE_DATE', 'employment_practices', 11,
      'Wages transferred by the statutory deadline',
      'Wages for a month must be transferred by the 15th of the following month.',
      array['wps_transfer_date'], array['wage_period_month'],
      '{"deadlineDayOfFollowingMonth": 15}',
      'WWAP checklist requirement 11 (Timely wage payment), UAE Wage Protection System. PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'Wages for {period} were transferred on {transferDate}. Deadline is day {deadlineDay} of the following month ({deadline}). {verdict}.'
    ),
    (
      'R11_WPS_COVERAGE', 'employment_practices', 11,
      'WPS file covers every worker and every division',
      'The WPS file must contain a record for every worker on the register, across every division.',
      array['wps_record_count'], array['worker_register_count', 'wps_divisions_present', 'expected_divisions'],
      '{"minCoverageRatio": 1, "requireAllDivisions": true}',
      'WWAP checklist requirement 11 (Timely wage payment), UAE Wage Protection System. PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'WPS file lists {recordCount} records against a worker register of {workerCount} ({coverage} coverage, minimum {minCoverage}). Divisions: {divisionsPresent} of {divisionsExpected} present{missingDivisions}. {verdict}.'
    ),
    (
      'R12_DEDUCTIONS', 'employment_practices', 12,
      'No prohibited payroll deductions',
      'Workers must not be charged for PPE, transport, work permits or Emirates ID.',
      array['payroll_deduction_types'], array[]::text[],
      '{"prohibitedTypes": ["ppe", "transport", "work_permit", "emirates_id"]}',
      'WWAP checklist requirement 12 (Full wages and benefits). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'Deductions recorded: {observed}. Prohibited types: {prohibited}. Found: {found}. {verdict}.'
    ),
    (
      'R13_OT_RATE', 'employment_practices', 13,
      'Correct overtime premium applied',
      'Overtime carries a 50% premium on a rest day, public holiday or between 22:00 and 04:00, and 25% otherwise.',
      array['overtime_rate_applied'], array['overtime_category'],
      '{"premiumPctStandard": 25, "premiumPctEnhanced": 50, "enhancedCategories": ["rest_day", "public_holiday", "night"], "nightWindow": {"from": "22:00", "to": "04:00"}}',
      'WWAP checklist requirement 13 (Correct overtime remuneration). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'Overtime worked on {category}: {appliedPct}% premium applied against a minimum of {requiredPct}% ({basis}). {verdict}.'
    ),
    (
      'R14_INSURANCE', 'employment_practices', 14,
      'Medical insurance in force from day one, covering every emirate',
      'The policy must start no later than the employment start date and cover all seven emirates.',
      array['insurance_policy_start_date', 'insurance_emirates_covered'], array['employment_start_date'],
      '{"requiredEmirates": ["abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"], "maxDaysAfterEmploymentStart": 0}',
      'WWAP checklist requirement 14 (Employer provided medical insurance). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'Policy starts {policyStart}; employment started {employmentStart} ({gap}). Emirates covered: {coveredCount} of {requiredCount}{missingEmirates}. {verdict}.'
    ),
    (
      'R16_HOURS', 'employment_practices', 16,
      'Working hours and rest days within legal limits',
      'At most 8 hours a day, 48 a week and 144 across 3 weeks, with one rest day in every seven.',
      array[]::text[], array['hours_per_day', 'hours_per_week', 'hours_per_three_weeks', 'max_consecutive_days_worked'],
      '{"maxHoursPerDay": 8, "maxHoursPerWeek": 48, "maxHoursPerThreeWeeks": 144, "maxConsecutiveDaysWorked": 6}',
      'WWAP checklist requirement 16 (Legal working hours). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'Per day {hoursPerDay} of {maxPerDay}; per week {hoursPerWeek} of {maxPerWeek}; per 3 weeks {hoursPerThreeWeeks} of {maxPerThreeWeeks}; longest run without a day off {consecutiveDays} of {maxConsecutive} days. {verdict}.'
    ),
    (
      'R18_CD_CERT', 'employment_practices', 18,
      'Civil defence certificate valid at the assessment date',
      'The certificate must still be valid on the date of the assessment.',
      array['civil_defence_expiry_date'], array[]::text[],
      '{"minDaysValidAfterAssessment": 0}',
      'WWAP checklist requirement 18 (Decent accommodation and food); civil defence certification. PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      'Civil defence certificate expires {expiry}; assessment date {assessmentDate} ({remaining}). Must remain valid at least {minDays} day(s) beyond the assessment date. {verdict}.'
    ),
    (
      'R18_ROOM_AREA', 'employment_practices', 18,
      'Floor area per resident meets the minimum',
      'Each resident must have at least 4.00 m² of room floor area.',
      array['drawing_room_area_m2', 'occupancy_headcount'], array['room_area_m2', 'room_occupancy'],
      '{"minAreaPerResidentM2": 4}',
      'WWAP checklist requirement 18 (Decent accommodation and food). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      '{area} m² / {occupancy} residents = {perResident} m² per resident. Minimum {minimum} m². {verdict}.'
    ),
    (
      'R18_ROOM_HEADCOUNT', 'employment_practices', 18,
      'Residents per room within the maximum',
      'A room must hold no more than 8 residents.',
      array['occupancy_headcount'], array['room_occupancy'],
      '{"maxResidentsPerRoom": 8}',
      'WWAP checklist requirement 18 (Decent accommodation and food). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      '{occupancy} residents in the room against a maximum of {maximum}. {verdict}.'
    ),
    (
      'R19_VEHICLE_REG', 'employment_practices', 19,
      'Every vehicle registration valid at the assessment date',
      'Every vehicle used to transport workers must have registration valid at the assessment date.',
      array['vehicle_registration_expiry_date'], array['vehicle_registrations'],
      '{"minDaysValidAfterAssessment": 0}',
      'WWAP checklist requirement 19 (Safe transportation). PENDING VERIFICATION: statutory citation to be confirmed by the client.',
      '{checked} checked against the assessment date {assessmentDate}: {expiredCount} expired or expiring{expiredDetail}. Registration must remain valid at least {minDays} day(s) beyond the assessment date. {verdict}.'
    ),
    (
      'ACM_TOILET_RATIO', 'accommodation', 3,
      'Sanitary fixtures per resident meet the required ratios',
      'Toilets, showers and washbasins must be provided at the required ratio per resident.',
      array[]::text[], array['residents', 'toilets', 'showers', 'washbasins'],
      -- PLACEHOLDER RATIOS: 1 fixture per 8 residents is seeded so the
      -- rule is executable. The figures in Cabinet Resolution 13 of 2009
      -- have not been verified against the published text — they are
      -- thresholds precisely so an admin can correct them without a code
      -- change. See docs/decisions.md.
      '{"maxResidentsPerToilet": 8, "maxResidentsPerShower": 8, "maxResidentsPerWashbasin": 8}',
      'Cabinet Resolution 13 of 2009 (general standards for labour accommodation), sanitary facilities. PENDING VERIFICATION: exact ratios to be confirmed against the published text.',
      '{residents} residents: toilets {toilets} of {toiletsRequired} required (1 per {perToilet}); showers {showers} of {showersRequired} required (1 per {perShower}); washbasins {washbasins} of {washbasinsRequired} required (1 per {perWashbasin}). {verdict}.'
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
