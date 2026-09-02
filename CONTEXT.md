# CONTEXT — Worker Welfare Assurance Platform (WWAP)

## What this is
A web platform used by an independent worker welfare consultancy to run assessments
of a real estate developer's supply chain, and to produce assessment reports in the
client's existing report format.

Three assessment modules on one backbone:
- Employment Practices — 73 entities/cycle. Office visit. 23 worker welfare requirements,
  10 of which are designated key requirements (5, 8, 10, 11, 14, 16, 17, 18, 19, 22).
- Onboarding — 17 entities/cycle. Desktop document review, then office visit,
  then a final compliance report. Same 23 requirements.
- Accommodation — 95 facilities/cycle. Physical inspection. 12 checklist areas,
  assessed against Cabinet Decision 13 of 2009 (500+ capacity) and Ministerial
  Resolution 212 of 2014 (under 500 capacity).

## Non-negotiable product rules
1. AI extracts. Deterministic code calculates. The assessor confirms.
2. The model NEVER performs arithmetic, date comparison, or threshold evaluation.
   It returns structured values; a typed rule engine evaluates them.
3. The model NEVER sets a compliance status. It produces observations only.
   Compliance status is written exclusively by a human assessor, attributed and logged.
4. Any AI output that reaches the report must have passed through an explicit human
   accept / edit / reject action, recorded with user id and timestamp.
5. The Claude API key is server-side only. No key, no direct model call, from the browser.
6. The audit log is append-only. Nothing in it is editable or deletable by any role.
7. Where evidence cannot support a conclusion, the system says
   "cannot be determined from this evidence" and routes it to the assessor.
   It never guesses to fill a field.

## Compliance ratings (fixed vocabulary — do not invent others)
Requirement/area level: Compliant | Partial | Not Compliant | Not Applicable
Question level:         Yes | No | Unclear | Not Applicable
Rules:
- Any answer of No, Unclear or Not Applicable requires a remark.
- Any answer of No or Unclear requires an "action required for closure".
- Any requirement rated Partial or Not Compliant requires an
  "action required for closure".
- Not Applicable requires a remark explaining why; no closure action needed.

Implemented in `lib/rules/` — see docs/decisions.md for the two things the brief
left unspecified (the report's percentage formulas and the risk rating) and the
assumptions made to fill that gap.

## Report output format (must match the client's existing app exactly)
Header block:
  Subject | Originator | Date | Description | Type | Project Type | Project Name |
  Associated Entity (or Level 01) | Accommodation Name (accommodation only) |
  Audit Number | Latest | Reassessed
Then: Risk (Low/Medium/High), Overall Compliance (%),
      Compliance adjusted for not assessed (%)
Then the table.

Employment Practices table columns:
  Worker Welfare Requirement | Remarks | Actions required for closure | Compliance Assessment

Accommodation table columns:
  Assessment area | Key Questions | Assessment | Remarks |
  Actions required for closure | Compliance

Subject code format: YEAR-MODULE-TYPE-ENTITYCODE[-AUDITNUMBER]
  e.g. 2023-EP-FU-GLIS-3.5, 2022-ACM-FU-DIC
  MODULE = EP | ACM | ONB ; TYPE = FU (follow-up) | IN (initial)

## Carry-forward boilerplate (use these strings verbatim)
Employment Practices, requirement not assessed this cycle but previously compliant:
  Remarks: "This section was not assessed as part of this review. Previous monitoring
  has identified the policies, procedures and their application relating to this section
  as compliant with Aldar's Worker Welfare Policy."
  Actions required for closure: "N/A"
  Compliance Assessment: (inherited from previous audit)

Accommodation, area not assessed this cycle but previously compliant:
  Remarks: "This section was not assessed as part of this review. The last review has
  identified this section as compliant with Aldar's Accommodation Facility Checklist."
  Actions required for closure: "N/A"
  Compliance: (inherited from previous audit)

## Stack
Next.js (App Router) + TypeScript + Tailwind
Postgres via Supabase (database, auth, storage, row-level security)
Zod for all model I/O validation
Vitest for unit tests, Playwright for the critical assessor path
Anthropic SDK server-side only (@anthropic-ai/sdk), model claude-sonnet-4-6
Deployed on Vercel

## Roles
admin | assessor | qa_reviewer | client_viewer
client_viewer sees approved reports and open findings for their own entities only.

## Design language
Direction B, "Field record" — the aesthetic of the inspector's notebook: durable,
tactile, quiet. See docs/decisions.md for the full rationale, the verified WCAG AA
contrast numbers, and why this direction was chosen over the two it replaced.

Four themes (paper/slate/ink/high-contrast) as CSS custom properties on
`[data-theme]`, palette only — typography, spacing, radii, and motion are invariant.
Paper (default) tokens: base #F2F1EE, surface #FFFFFF, ink #1B1F23,
secondary ink #565E64, hairline #E0DFDA, accent/compliant moss #2F5D3A,
partial amber #8A6415, not-compliant brick #9E3B33, not-applicable = secondary ink.
8px control radius; exactly one shadow level, used only on things that float
(the command palette, drawers) and never on static content.
Two type families: IBM Plex Sans for everything, IBM Plex Serif reserved
exclusively for large display numerals.
Motion budget: one orchestrated moment on the landing page hero; everywhere else,
120ms/200ms on one easing curve, nothing more.

## Conventions
- Every table has id (uuid), created_at, updated_at, created_by.
- Soft delete only (deleted_at). Never hard delete assessment data.
- All AI prompts live in /lib/ai/prompts/ as versioned files (v1, v2...) and every
  stored extraction records the prompt version and model used.
- Every schema change updates docs/schema.md in the same commit.
- Every significant decision appends to docs/decisions.md with date and rationale.
