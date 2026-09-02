-- Aligns extracted_facts with the document extraction service's actual
-- fact shape (this prompt): "every returned fact carries: fact_key, value,
-- unit, page_ref, verbatim_quote, confidence (high|medium|low)" plus the
-- absent/illegible reason. 0005_evidence_ai.sql predates this prompt and
-- had confidence as an unconstrained numeric (no "high/medium/low"
-- vocabulary existed yet) and no verbatim_quote or reason column at all.
--
-- Safe to alter in place rather than add new columns and deprecate the
-- old ones: no live Supabase project has ever run against this schema
-- (checked — this repo has no production data anywhere).

alter table public.extracted_facts alter column confidence type text using confidence::text;
alter table public.extracted_facts add constraint extracted_facts_confidence_check
  check (confidence in ('high', 'medium', 'low'));

alter table public.extracted_facts add column verbatim_quote text;

-- "If a value is absent or illegible return {"value": null, "reason":
-- "not_present" | "illegible"}" (this prompt). Nullable — only meaningful
-- alongside a null value; lib/ai/schema.ts's Zod schema enforces "reason
-- is set exactly when value is null" before a row ever reaches this table.
alter table public.extracted_facts add column reason text
  check (reason in ('not_present', 'illegible'));

-- value_text/value_number/value_date (0005_evidence_ai.sql) don't cover
-- every fact's natural type: a handful of v1 fact keys are boolean
-- (agency_employer_pays_clause_present) or list-valued
-- (payroll_deduction_types, insurance_emirates_covered — an array of
-- strings). Extending the existing typed-column-per-shape pattern rather
-- than collapsing everything into one untyped jsonb column, which would
-- give up the ability to query/index by value type the way the other four
-- columns already allow.
alter table public.extracted_facts add column value_boolean boolean;
alter table public.extracted_facts add column value_json jsonb;
