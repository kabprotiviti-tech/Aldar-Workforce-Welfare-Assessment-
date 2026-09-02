-- Every RLS policy from 0002-0007 was unreachable without this: a Postgres
-- role needs a table-level GRANT before RLS is even consulted — a policy
-- restricts rows on top of a grant, it doesn't create one. audit_log
-- (0001_init.sql) already had its own explicit grant; every other table
-- did not, and so denied `authenticated` outright regardless of policy.
-- Caught by tests/db/client-viewer-rls.test.ts failing with "permission
-- denied for table users" rather than an RLS-shaped failure.
--
-- Deliberately explicit rather than relying on whatever default
-- privileges a given Supabase project may or may not have pre-configured
-- for newly created tables — correct either way, and portable to any
-- plain Postgres (including the local test harness).
--
-- Granted only where a matching policy exists: SELECT wherever a select
-- policy exists, INSERT/UPDATE wherever an insert/update policy exists.
-- DELETE is granted nowhere here — no table below has a delete policy,
-- matching CONTEXT.md's "soft delete only" convention at both layers.

grant select on public.users to authenticated;

grant select, insert, update on
  public.organisations,
  public.entities,
  public.entity_contacts,
  public.facilities,
  public.cycles
to authenticated;

grant select, insert, update on
  public.checklist_templates,
  public.requirements,
  public.questions
to authenticated;

grant select, insert, update on
  public.assessments,
  public.assessment_items,
  public.assessment_answers
to authenticated;

-- evidence_files: authenticated actors upload and review directly.
-- extractions/extracted_facts/ai_observations: written only by the
-- service-role client (lib/audit.ts-style server code), so no INSERT
-- grant for authenticated — only SELECT, plus UPDATE where a human
-- resolves a fact or observation.
grant select, insert, update on public.evidence_files to authenticated;
grant select on public.extractions to authenticated;
grant select, update on public.extracted_facts to authenticated;
grant select, update on public.ai_observations to authenticated;

grant select, insert, update on public.rule_definitions to authenticated;
-- rule_evaluations is an append-only computation log (no update policy).
grant select, insert on public.rule_evaluations to authenticated;
grant select, insert, update on public.rooms to authenticated;
grant select, insert, update on public.photos to authenticated;

grant select, insert, update on public.findings to authenticated;
-- finding_events is an append-only history log (no update policy).
grant select, insert on public.finding_events to authenticated;
grant select, insert, update on public.reports to authenticated;
