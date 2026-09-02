-- The observation layer (this prompt): the narrative the model writes
-- between facts, rules and the assessor. 0005_evidence_ai.sql created
-- ai_observations with the right three kinds already; this adds what
-- source referencing, rejection-with-reason, and assessor-authored
-- observations need.

-- "Every observation carries a source reference (file, page, fact key)"
-- (this prompt). source_ref (0005) is free text; these are the structured
-- halves that can actually be checked and clicked. An observation with
-- none of them is discarded before it is ever stored
-- (lib/observations/generate.ts), which is why there is no "unsourced"
-- state to represent here.
alter table public.ai_observations add column source_fact_keys text[] not null default '{}';
alter table public.ai_observations add column page_ref text;

-- Which requirement the observation maps to. Reachable through
-- assessment_items, but stored directly as well: the assessor workspace
-- and the report both query "observations for this requirement", and the
-- generator sets it from the item rather than from anything the model
-- said.
alter table public.ai_observations add column requirement_id uuid references public.requirements (id);

-- Which rule result produced it. The kind is derived from that result's
-- outcome by code, never by the model (this prompt) — keeping the link
-- means the derivation can be re-checked later.
alter table public.ai_observations add column rule_code text;
alter table public.ai_observations add column rule_evaluation_id uuid references public.rule_evaluations (id);

-- Provenance for a model-written narrative, matching what extractions
-- records: which model and which prompt version wrote it.
alter table public.ai_observations add column model text;
alter table public.ai_observations add column prompt_version text;

-- "Rejected observations are retained with reason" (this prompt). The
-- row stays, the status becomes 'rejected', and the reason is required by
-- the server action rather than by a check constraint, since the column
-- must stay null for every other status.
alter table public.ai_observations add column rejection_reason text;

-- Who wrote it. 'model' for a generated narrative; 'assessor' for one
-- added by hand through "Add observation" — which is a first-class
-- source, not an afterthought, so it needs to be distinguishable in the
-- report and in the audit trail.
alter table public.ai_observations add column authored_by text not null default 'model'
  check (authored_by in ('model', 'assessor'));
alter table public.ai_observations add column created_by uuid references auth.users (id);

create index ai_observations_requirement_status_idx on public.ai_observations (requirement_id, status);
create index ai_observations_item_status_idx on public.ai_observations (assessment_item_id, status);

-- 0008_grants.sql granted only select/update to `authenticated`, because
-- until now every row was model-written through the service-role client.
-- "Add observation" makes an assessor a genuine author, so they need
-- insert — restricted to the operational-write roles by policy, the same
-- pair as every other assessor write in this schema.
grant insert on public.ai_observations to authenticated;

create policy "ai_observations_insert_staff" on public.ai_observations
  for insert to authenticated with check (public.can_write_operational());
