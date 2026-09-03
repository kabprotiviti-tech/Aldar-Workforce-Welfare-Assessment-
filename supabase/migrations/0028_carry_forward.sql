-- Carry-forward from the previous assessment cycle (this prompt).
--
-- The previous cycle's status/remarks/action are recorded in their own
-- columns rather than in compliance_status/remarks/action_required
-- directly, because 0024_assessment_decision.sql's own trigger already
-- guarantees something this feature must not undermine: a status is
-- only ever written by an authenticated assessor deciding it, stamped
-- and audited as that decision. Writing last cycle's status straight
-- into compliance_status at item-creation time would either need an
-- actor who didn't decide anything, or would misrepresent an inherited
-- value as a fresh decision. These columns are a snapshot for reference
-- and for the eligibility check; the live compliance_status is always
-- set afterwards by an explicit assessor action — either a genuine
-- reassessment, or the "not assessed this cycle" confirmation, which is
-- itself a real decision even though the value it writes happens to
-- equal last cycle's.
alter table public.assessment_items add column previous_compliance_status text
  check (previous_compliance_status in ('Compliant', 'Partial', 'Not Compliant', 'Not Applicable'));
alter table public.assessment_items add column previous_remarks text;
alter table public.assessment_items add column previous_action_required text;
