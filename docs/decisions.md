# Decisions

## 2026-09-02 — Project skeleton and stack versions

Bootstrapped the repository from empty: Next.js (App Router) + TypeScript +
Tailwind + Zod + Vitest, per the stack in the project brief.

- Used Next.js 16.3.4 and postcss 8.5.26 rather than the originally-drafted
  14.2.5/8.4.39 — `npm audit` flagged known CVEs (cache poisoning, DoS,
  XSS/path-traversal in postcss sourcemap handling) against those versions
  with no non-breaking patched release on the 14.x line covering all of
  them. Nothing in the codebase depends on 14.x-specific behavior, so we
  took the current stable major instead. React stays on 18.3.1 (a supported
  peer of Next 16).
- Used Vitest 4.1.11 instead of 1.6.0 for the same reason (esbuild/vite dev-
  server CVE in the 1.x dependency chain). No project code depended on
  Vitest 1.x-only APIs.
- `npm audit` reports 0 vulnerabilities as of this install.

## 2026-09-02 — Deterministic compliance rule engine (`lib/rules/`)

Built the typed rule engine implementing the two things the brief says a
model must never be trusted with: validating that a chosen compliance
status carries the required remark/closure action, and the arithmetic for
the report header metrics. The AI extraction layer, the assessor UI, the
database, and the report renderer are out of scope for this change — this
is the standalone, fully-tested calculation core they will all call into.

**Implemented exactly as specified** (`lib/rules/validation.ts`):
- Question level: `No`/`Unclear`/`Not Applicable` require a remark;
  `No`/`Unclear` additionally require an action required for closure.
- Requirement/area level: `Partial`/`Not Compliant` require an action
  required for closure; `Not Applicable` requires a remark and no closure
  action.
- Validation never assigns or corrects a status — it only reports which
  field is missing, so the item can be routed back to the assessor (rule 7
  in the brief: "cannot be determined" is a routing decision, not a guess
  the engine makes).

**Assumptions made — not fully specified in the brief, flagged for
assessor/client review before they drive a real report** (`lib/rules/aggregate.ts`):
1. **Scoring weights.** `Compliant` = 1, `Partial` = 0.5, `Not Compliant` = 0,
   `Not Applicable` excluded from both numerator and denominator (it isn't a
   compliance measurement). No weighting formula for "Overall Compliance
   (%)" appears in the brief; half-credit for Partial is the common
   convention in this kind of audit scoring but should be confirmed against
   the client's existing report tool before this becomes load-bearing.
2. **"Overall Compliance (%)" vs. "Compliance adjusted for not assessed (%)".**
   Read as: Overall includes carried-forward (not-assessed-this-cycle)
   requirements at their inherited rating; the adjusted figure excludes
   carried-forward requirements from the denominator entirely, showing
   compliance only across what was actually assessed this cycle. This is
   the most literal reading of "adjusted for not assessed" but the brief
   doesn't give a worked example — needs confirming against a real client
   report before shipping.
3. **Risk rating (Low/Medium/High).** Driven only by the 10 key
   requirements, since the brief singles them out: High if any key
   requirement is `Not Compliant`; Medium if a key requirement is `Partial`
   or any non-key requirement is `Not Compliant`; Low otherwise. No
   percentage threshold was introduced on top of this since none is given
   in the brief — adding one would be a second layer of invented business
   logic. Accommodation has no key requirements, so this function only
   applies to Employment Practices / Onboarding.

All three are isolated behind named functions in `aggregate.ts` specifically
so the formulas can be corrected without touching validation or any caller.

## 2026-09-02 — Design direction: "Field record"

The client had rejected two prior proposals for reading as generic AI-tool
output. First pass at this brief chose Direction A ("Survey instrument");
the brief was then edited to remove every direction but **Direction B —
"Field record"**, which is what's built.

Field record's register — durable, tactile, quiet, the inspector's
notebook rather than the analyst's spreadsheet — still fits the product:
an assessor doing a physical accommodation inspection or a document review
is filling in a record on-site, not running a dashboard. One shadow level
reserved strictly for things that float above the page (drawers, the
command palette) gives the interface a small amount of depth without
touching the discipline the brief is actually testing for: no shadow ever
sits under static content, no two radii fight each other, nothing is
decorated because a template expects it there.

**Palette — verified against WCAG AA, not assumed.** Every ink/accent/status
color below was run through a relative-luminance contrast calculation
against its actual background before being used anywhere (a small Node
script computing the WCAG contrast-ratio formula on each foreground/
background pair — trivial to re-derive, not committed). All pass 4.5:1 for
text; several clear 6:1+.

| Role | paper (default) | slate | ink (dark) | high-contrast |
|---|---|---|---|---|
| Background | #F2F1EE | #E6E8E6 | #1C1F1C | #FFFFFF |
| Surface | #FFFFFF | #FFFFFF | #242723 | #FFFFFF |
| Ink (primary text) | #1B1F23 | #1B1F23 | #EDEBE6 | #000000 |
| Secondary text | #565E64 | #565E64 | #A9ADA6 | #303030 |
| Hairline | #E0DFDA | #D3D6D2 | #34372F | #000000 (1.5px) |
| Accent / Compliant (moss) | #2F5D3A | #2F5D3A | #5B9C6F | #1D4028 |
| Partial (amber) | #8A6415 | #7A5710 | #D9A548 | #5C3D00 |
| Not compliant (brick) | #9E3B33 | #9E3B33 | #E2695A | #7A2A22 |
| Not applicable | = secondary text | = secondary text | = secondary text | = secondary text |

Two deliberate choices worth flagging:
- **Accent and Compliant share one moss value.** The brief names moss as
  the accent and gives amber for partial but doesn't name a separate
  "compliant" color; introducing a second green would read as arbitrary in
  a palette this disciplined, and "moss = the good/active state" is a
  coherent read for a field-record tool. Interactive controls and
  compliant-status text never appear in the same visual context (buttons/
  links vs. status cells in a table), so the reuse doesn't create
  ambiguity in practice.
- **`slate`'s amber is darkened** (#7A5710 vs. paper's #8A6415) — the
  stock value only cleared 4.36:1 against slate's cooler, slightly darker
  background, short of 4.5:1. Every other status color carried over
  unchanged and still passed against both light backgrounds.

`high-contrast` uses a heavier (1.5px) hairline weight since a 1px
hairline in the shared value carries no non-text-contrast guarantee at
pure black/white. Every other geometry token (the 8px radius, spacing,
type scale, motion) is identical across all four themes by construction —
one set of tokens, themes override color values only.

**Shadow — one level, and only on things that float.** `--shadow-float`
(`0 10px 24px -8px`, color/opacity themed the same way as every other
token) is applied through a single `.shadow-float` utility used exclusively
by the command palette and drawers. No card, table, or static section ever
carries it — that boundary is the actual point of Direction B, not the
shadow's existence.

**Typography — two families, deliberately paired.** IBM Plex Sans carries
every heading, body, and label (self-hosted via `next/font/google`, woff2,
subset to latin, `display: swap`) — designed for technical/engineering
interfaces, not a marketing face repurposed for body copy, which fits a
"durable, tactile" register better than the obvious defaults the brief
bans outright. IBM Plex Serif is reserved exclusively for large display
numerals (`.numeral-display` / `font-numeral` — the report's compliance
percentages, nothing else) so a figure reads as a measurement rather than
as decoration. Same type family, same metrics, serif vs. sans — categorically
distinct as the brief requires without the pairing feeling arbitrary.
Tabular figures (`font-variant-numeric: tabular-nums`) apply everywhere,
not just inside `.numeral-display`.

**Motion.** One easing curve (`cubic-bezier(0.2, 0, 0, 1)`), two durations
(120ms micro-interaction, 200ms structural — drawer/palette open), defined
once as CSS custom properties and reused everywhere; nothing else animates.
`prefers-reduced-motion: reduce` collapses both durations to near-zero and
strips the landing-page hero trace to its end state.

**What was removed from each screen before calling it done** (per the
brief's own closing instruction):
- Landing hero: first draft had the evidence trace glow/pulse on the
  active node to show progress — removed; a filled vs. unfilled hairline
  dot with an instant color change reads as a measurement, a pulse reads
  as a demo.
- Report sample: first draft gave every header field its own bordered
  card — removed in favor of a single hairline grid (1px rules between
  cells via a background-color grid gap), which is what the client's own
  report actually looks like and reads as one instrument, not six widgets.

## 2026-09-02 — Auth, env validation, and the append-only audit log

Wired up Supabase Auth (email/password), the `public.users` and
`public.audit_log` tables, and boot-time env validation, per the brief.
Scope stayed to exactly what was asked: a plain sign-in page and an empty
`/app` shell, nothing more.

**Env var naming — one deliberate deviation from the literal brief.** Asked
to fail loudly if `SUPABASE_URL` is missing; the actual var is named
`NEXT_PUBLIC_SUPABASE_URL`. Next.js only inlines `NEXT_PUBLIC_`-prefixed
vars into the browser bundle, and the URL has to reach `lib/supabase/browser.ts`
— so it's declared once under that name (`lib/env/client.ts`) and re-checked
from `lib/env/server.ts`, rather than duplicated under a second, server-only
name for no functional reason. The value isn't secret either way (the anon
key is designed to be public; RLS is what actually protects data) — only
the "fail loudly if missing" behavior mattered, and it's preserved exactly:
booting without it throws the same way booting without
`SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` does.

**"Fail loudly at boot" — two mechanisms, not one.** `instrumentation.ts`'s
`register()` imports `lib/env/server`, which is Next's documented hook for
one-time server-boot work — this is the literal "at boot" check. In
practice a second, earlier failure mode showed up during manual testing:
Next.js evaluates a route's module graph during `next build`'s page-data
collection for any dynamically-rendered route (here, `/app` and `/sign-in`,
since both read cookies/searchParams), so a missing var fails the *build*
itself, before a server ever boots. Both are documented as intentional:
whichever runs first, the failure is loud either way. One consequence: the
build now needs placeholder env values to succeed at all if `/app` or
`/sign-in` are touched, even though `/` and `/workspace` don't need them —
a real cost of adding auth, accepted rather than worked around.

**Client vs. server vs. admin Supabase clients.** Three files, one job
each: `lib/supabase/browser.ts` (anon key, client components),
`lib/supabase/server.ts` (anon key + the caller's session cookie, respects
RLS — every normal Server Component/Action/Route Handler should use this),
`lib/supabase/admin.ts` (service-role key, bypasses RLS, server-only). The
service-role key is guarded by the `server-only` package, not just by
convention: any client component that imports it, even transitively, is a
*build error*, not a runtime leak. `writeAudit()` (`lib/audit.ts`) is the
one thing that uses the admin client, and it only ever calls `.insert()`.

**Sign-in uses a Server Action, not a browser-side Supabase client.**
`lib/auth/actions.ts`'s `signInWithPassword` runs entirely server-side,
sets the session cookie itself, and redirects to `/app` on success or back
to `/sign-in?error=...` on failure — the sign-in page ships zero client
JS. This is Supabase's own recommended App Router pattern, and it means
the acceptance criterion ("no service-role key or Anthropic key in any
client bundle") has nothing to even scan for on this page: no Supabase
client of any kind is imported by client-bundled code here.

**`middleware.ts` → `proxy.ts`.** Next 16 deprecated the `middleware`
file convention in favor of `proxy` mid-way through writing this — caught
by the build's own deprecation warning, fixed immediately (file renamed,
exported function renamed from `middleware` to `proxy`, same `config.matcher`).
Scoped the matcher to `/app/:path*` and `/sign-in` only, not every route, so
the session-refresh cost and the Supabase env dependency don't spread to
the marketing site or `/workspace`, which have no reason to need either.

**Audit log append-only — proven, not just asserted.** No Docker available
in this environment, so a full local Supabase stack couldn't be started;
what *is* available is a local Postgres 16 install, which is what
Supabase's RLS enforcement actually runs on underneath the BaaS layer. Set
that up (`tests/db/local-setup.sql` recreates just enough of a Supabase
project's shape — the `anon`/`authenticated`/`service_role` roles and a
minimal `auth.users` + `auth.uid()` stand-in — for the real, unmodified
`supabase/migrations/0001_init.sql` to run against it unchanged) and wrote
`tests/db/audit-log.rls.test.ts`, which really connects as `authenticated`
and really attempts `UPDATE`/`DELETE` against an existing row — with table-
level grants for both commands present, specifically so the only thing
that can be stopping the write is the RLS policy itself, not a missing
`GRANT`. Ran it in this session: 3/3 pass. It skips cleanly (not a hard
failure) if `TEST_DATABASE_URL` isn't reachable, since not every
environment this repo runs in will have a Postgres available.

One caveat this test cannot cover, and the migration's own comment says
so: `service_role` bypasses RLS by design in Postgres/Supabase, for any
role that carries `BYPASSRLS` — no policy can change that. `writeAudit()`
is the only code path that uses the service-role client, and it only ever
calls `.insert()`, so that bypass is never exercised by this app. If a
future change ever gives the admin client an update/delete path onto
`audit_log`, this stops being sound and needs revisiting.

**What wasn't fully proven.** "A user can sign in and hit a protected
`/app` route" was verified structurally and for the fail-closed half: a
real HTTP request to `/app` with no session returns a 307 to `/sign-in` in
a production build (`next start`), confirmed in this session. The
success half — valid credentials landing on `/app` — needs a live
Supabase project with a real user in it, which doesn't exist in this
environment; provisioning one and running that path end-to-end is the
first thing to do before treating this as fully verified.

## 2026-09-02 — Full schema: 16 new tables, generated types, seed, RLS proof

Built out the rest of the schema from CONTEXT.md's table list: core
(organisations/entities/facilities/cycles), versioned templates,
assessments, evidence/AI, rules/measurement, findings/reports — 16 new
tables across `0002_core.sql` through `0008_grants.sql`, one Zod schema +
TS type per table in `lib/db/` (`z.infer`, same pattern as `lib/rules/`),
an idempotent seed script, and a real RLS test proving a client_viewer
can't read another entity's findings.

**Two gaps in the literal spec, closed and documented rather than
silently patched.** `organisations` was listed under "Core (from prompt
1)" but never actually existed — `0001_init.sql` left
`users.organisation_id` with no FK target. And nothing in the schema said
how a client_viewer's row maps to "their entity_id," which the RLS
acceptance criterion requires — added `users.entity_id` (nullable, set
only for client_viewer) as the direct link. Both closed in `0002_core.sql`
with a comment at the point they're closed, not folded silently into
column definitions.

**The `authenticated` role had no table-level GRANT — RLS policies alone
don't do anything.** Every table from `0002` through `0007` got RLS
enabled and reasonable policies, and every one of them was completely
unreachable, because a Postgres role needs a GRANT on the table before
RLS is even consulted — a policy restricts rows on top of a grant, it
doesn't create one. `audit_log` (`0001_init.sql`) was fine because it
happened to grant all four verbs explicitly, specifically to prove the
*policy* (not a missing grant) was what blocked update/delete. Nothing
else had that. This surfaced as `tests/db/client-viewer-rls.test.ts`
failing with "permission denied for table users" — a permission error,
not an RLS-shaped empty result — while writing the very first test
against a real `authenticated` connection. `0008_grants.sql` fixes it,
granting exactly what each table's policies assume (SELECT wherever a
select policy exists, INSERT/UPDATE wherever those policies exist, DELETE
nowhere). Real Supabase projects may pre-configure default privileges
that would have masked this in production — deliberately not relied on
that: the migrations grant explicitly, so they're correct on any Postgres,
including the local one this was tested against, not just a Supabase
project configured a particular way.

**Two vocabularies now named "module."** `lib/rules/constants.ts`'s
`MODULES` (`EP`/`ONB`/`ACM`, used for report subject-code formatting) and
the database's `module` columns (`employment_practices`/`onboarding`/
`accommodation`, this prompt's literal spec) name the same three things
differently, for different purposes, and nothing currently maps between
them. Not reconciled here — flagged in `lib/db/common.ts` and left for
whichever code first needs to move between the two (report generation,
most likely).

**Template/rule immutability is a convention, not a constraint.** CONTEXT.md
and this prompt both say reports must stay reproducible against the
template version they were assessed under, which means a
`checklist_templates`/`requirements`/`questions` row shouldn't change once
a template is `is_active` and assessments exist against it. Didn't add a
trigger enforcing that (e.g. blocking UPDATE once `is_active = true`) —
there's no "draft" state modeled for templates yet, so a real content
workflow would need one before a freeze mechanism makes sense, and
building both wasn't asked for. Documented instead, in `0003_templates.sql`
and here, as a team-practice rule until a content-authoring flow exists to
enforce it.

**client_viewer's access is deliberately narrower than "everything about
their entity."** CONTEXT.md says a client_viewer sees "approved reports and
open findings for their own entities only" — not assessment content, not
evidence, not AI extractions. Read that literally: `evidence_files`,
`extractions`, `extracted_facts`, `ai_observations`, `rule_definitions`,
`rule_evaluations`, `rooms`, `photos`, `checklist_templates`,
`requirements`, `questions`, `cycles`, `organisations`, `entity_contacts`,
and `finding_events` have no client_viewer policy at all — RLS's default
with no matching policy is deny, so that's zero access, not an oversight.
`entities`, `facilities`, and `assessments` get a narrow client_viewer
policy anyway, only because a report/finding is unreadable without being
able to resolve the entity/facility/assessment names it references.

**"Open findings" reads as "not closed," not the literal status `open`.**
`findings.status` is a five-stage lifecycle
(open/in_progress/evidence_submitted/under_review/closed). CONTEXT.md's
"open findings" predates that lifecycle and almost certainly means
"outstanding," not literally `status = 'open'` — a client tracking their
own remediation work needs to see `in_progress` and `evidence_submitted`
items too. Implemented as `status <> 'closed'`.

**`rooms.computed_m2_per_person` is a generated column.** Not a value any
caller sets — CONTEXT.md rule 2 ("the model never performs arithmetic ...
a typed rule engine evaluates") applies just as much to a human typing
numbers into a form as it does to the model calling the Claude API.
Verified against a real insert: 24m² / 6 occupants computed to exactly 4.

**What's proven against a real Postgres, run in this session:** every
migration applies cleanly from empty, twice in a row, with RLS enabled on
all 24 tables (`\d+`-verified); the seed fixture's upsert-by-fixed-id
pattern is idempotent (`tests/db/seed.idempotent.test.ts`, run twice,
exact expected row counts both times); a client_viewer scoped to entity A
sees entity A's finding, cannot read entity B's finding by id even when
querying it directly, a second client_viewer scoped to entity B sees only
entity B's, and admin sees both regardless of entity
(`tests/db/client-viewer-rls.test.ts`).

**What isn't proven, and why:** `scripts/seed.ts` itself creates its four
auth users through the Supabase Admin API (`auth.admin.createUser`/
`listUsers`), which needs a live Supabase project running GoTrue — this
environment has a local Postgres, not a full Supabase stack (no Docker
available to run one). What the test above actually proves is the part
downstream of that API call and specific to this codebase: that upserting
every `public.*` row by a fixed id is genuinely idempotent against the
real migrations. The Admin API calls themselves are Supabase's own
well-tested SDK surface, not new code written here, but running
`scripts/seed.ts` itself end-to-end against a real project is still the
first thing to do before treating it as fully verified — the same
boundary noted for sign-in above.

**Vitest needed a path-alias fix and forced-serial test files, unrelated to
this schema but caught while building it.** `lib/db/*.ts` importing via
`@/lib/rules/constants` (the same alias tsconfig defines) worked under
`tsc` but failed at runtime under Vitest, which doesn't read tsconfig
paths on its own — fixed with an explicit `resolve.alias` in
`vitest.config.mts`. Separately, two `tests/db/*.test.ts` files each
resetting the whole `public` schema in `beforeAll` raced each other when
Vitest ran them in parallel (`duplicate key value violates unique
constraint "pg_extension_name_index"`) — fixed with `fileParallelism:
false`, cheap for a suite this size and the correct fix for tests sharing
one physical external resource, rather than trying to isolate every DB
test into its own throwaway database.

## 2026-09-02 — Template v1 content, immutability by trigger, quantitative schema

Seeded checklist_templates v1 for all three modules with real content —
the 23 Employment Practices/Onboarding requirement titles and `is_key`
flags, the 12 Accommodation area titles — and made "immutable once
referenced" an actual database guarantee instead of the comment
`0003_templates.sql` left it as.

**Convention → trigger.** `0003_templates.sql` said template content
should freeze once in use but didn't enforce it, on the grounds that
there was no draft-state workflow yet to make a freeze mechanism useful.
This prompt's acceptance criteria ask for exactly that guarantee, proven
by a test — so `0009_template_immutability.sql` adds it: a trigger on
`checklist_templates`/`requirements`/`questions` that blocks any
UPDATE/DELETE, and any INSERT of a new sibling row, the moment
`public.assessments` has a row pointing at that template. Triggers fire
for every role, including a superuser — a stronger guarantee than RLS,
which a `BYPASSRLS` role like `service_role` sidesteps entirely (see the
audit_log entry above). The one exception is `checklist_templates.is_active`:
retiring an in-use version by flipping it to inactive still has to work,
so the trigger diffs OLD vs NEW and only blocks a change that touches any
other column. Proven in `tests/db/template-immutability.test.ts`: editing,
deleting, or adding a sibling to a referenced template's content all
raise; toggling `is_active` on it still succeeds; creating v2 with
deliberately different content leaves v1's own requirements, its
assessment's `template_id`, and its report row completely unchanged; and
a template with no assessment against it yet can still be edited freely
(the mechanism doesn't over-block).

**assessment_items needed a `quantitative` column that didn't exist.**
The Accommodation template's mandatory fields (location, capacity,
occupancy, area per resident, etc.) are captured "per area, regardless of
the answer given" — i.e. scoped to one assessment_item, not to one
question's answer. The existing `assessment_answers.quantitative`
(0004_assessments.sql) is the wrong home for that: it's a child of one
specific question. Added `assessment_items.quantitative jsonb`
(`0011_assessment_items_quantitative.sql`) instead.

**The quantitative field → area mapping is this file's own judgment call,
not given directly, and needs confirming.** The brief lists eight kinds of
mandatory quantitative data (location/capacity/occupancy,
area-per-resident, residents-per-toilet/shower/washbasin, kitchen and mess
hall details, clinic type/capacity/provider, certificate/contract
validity) and says to model them "per area," without saying which of the
12 areas each belongs to. `lib/db/accommodation-quantitative.ts` assigns:
location/capacity/occupancy to area 1 (General requirements);
area-per-resident to area 2 (Bedrooms); the three per-fixture ratios to
area 3 (Bathrooms); kitchen details to area 4 (Kitchens); mess hall
details to area 5 (Mess halls); clinic fields to area 6 (Medical
services); and — the least certain part of this mapping — a reusable
`certificateSchema` (type/number/issuer/validity dates) attached to areas
1, 6, 11 (Utilities), and 12 (Firefighting and alarm systems), on the
reasoning that those are the areas most plausibly gated by an actual
certificate. Areas 7-10 (Laundry, Public health requirements,
Accommodation management, Health safety and security) get no mandatory
quantitative fields at all — none were named for them, and inventing one
felt worse than leaving it empty. All of this is a schema-design guess in
the absence of the real checklist, not fabricated regulatory content —
worth confirming against the actual Cabinet Decision 13/2009 and
Ministerial Resolution 212/2014 checklists before it's load-bearing.

**What's still missing, deliberately, per this prompt's own instruction
not to invent it:** the EP/Onboarding `detail_text` (each requirement's
lettered sub-clauses) and the Accommodation template's numbered key
questions (1.1, 1.2, ...) per area. Neither exists anywhere in this repo
(checked before writing anything — grepped for recognisable fragments of
the given requirement titles and found only this session's own earlier,
unrelated placeholder/demo data). Both are real client policy content,
not something to approximate. `requirements.detail_text` is seeded
`null` throughout; `questions` has zero rows for the Accommodation
template. Asked the user to paste both, and to confirm or correct the
quantitative-field mapping above, rather than guessing further.

## Design system and app shell

**A second, `ds`-prefixed token namespace, coexisting with the marketing
site's tokens rather than replacing them.** The brief gives a fixed light-mode
palette (`bg`/`surface`/`ink`/`accent`/etc.) for the product app. The
marketing microsite already has its own token set (unprefixed —
`--bg`, `--ink`, and so on) from the earlier "Field record" direction, which
was explicitly scoped as "the one place to spend visual boldness... its own
layout," separate from the app. Reusing those names for the app's tokens
would mean either the app inherits marketing's boldness or the marketing
site gets quietly restyled to the app's calmer palette — neither was asked
for. Defined the new palette as `--ds-bg`, `--ds-surface`, `--ds-ink`, etc.
in `app/globals.css`, wired through `tailwind.config.ts` as `ds-*` color/
radius/shadow utilities, and built every new component and route
(`components/ds/`, `components/shell/`, `app/gallery`, `app/app/*`) against
only that namespace. The marketing routes are untouched.

**`ink-3` (#7A8792) is real but restricted, and ends up unused.** Checked
every token's contrast computationally (relative-luminance script, not
assumption) rather than trusting the brief's hex values are AA by
construction. `ink-3` on `bg` and on `surface` comes out to 3.37:1 and
3.68:1 — short of the 4.5:1 normal-text threshold, only clearing the 3:1
large-text/non-text one. Caught two accidental uses of it on genuinely
small text while building — the nav's "Assessment Programmes" group label
and the Field/Textarea placeholder color — and moved both to `ink-2`
(6.1:1+). No component ended up with a legitimate large-text-only use case,
so `ink-3` stays defined (the brief names it explicitly) but unused rather
than forced into a spot where it would fail AA.

**`color-mix()` instead of Tailwind's opacity modifier for tinted
surfaces.** Tailwind's `bg-x/40` opacity syntax only produces valid CSS when
the underlying custom property holds an RGB channel triplet (`16 34 46`);
every `ds-*` token is a plain hex string, so that modifier would silently
emit `rgb(var(--ds-x) / 0.4)` — invalid, and not visibly broken until
inspected. Used `color-mix(in srgb, var(--ds-x) N%, white|transparent)`
dedicated classes instead: `.ds-pill-*` (12%/28% tints for the five status
tones) and `.ds-overlay` (40% ink-over-transparent for the Drawer backdrop).

**ESLint pinned to 9.39.5, not the newly-released 10.x.** Next.js 16 removed
the `next lint` subcommand entirely, so the no-hardcoded-hex requirement
needed a real standalone ESLint setup regardless. `eslint-config-next`'s
bundled `eslint-plugin-react` 7.37.5 calls `context.getFilename()`, an API
ESLint 10 removed — every lint run crashed with
`contextOrFilename.getFilename is not a function`, not a peer-range
warning. Pinned `eslint` to 9.39.5 (the last major line these bundled
plugins fully support) instead of patching or forking the plugin.
`eslint.config.mjs` spreads `eslint-config-next`'s default export directly
(`...nextConfig`) — it's a plain array, not a factory function, despite the
common `require("eslint-config-next")()` pattern seen elsewhere — and adds a
local `no-hardcoded-hex` rule (flags any hex-color literal or template
fragment) scoped to exclude `.next/`, migrations, and generated files.
Verified the rule isn't a no-op by deliberately committing a violation to a
throwaway file and confirming ESLint caught it before deleting the file.

**Quality floor verified computationally, not assumed:** contrast via the
script above; 380px responsiveness and the mobile nav Drawer via Playwright
screenshots at that exact width (`document.body.scrollWidth` equals the
viewport width — no page-level horizontal scroll; the Table's own
`overflow-x-auto` is the only intentional scroll container); keyboard
navigation and focus-ring visibility via a Playwright script that repeatedly
presses Tab and reads `document.activeElement`'s computed `outline` (lands
on a 2px solid `--ds-accent` outline, 2px offset, matching `.ds-focus-ring`);
`prefers-reduced-motion` is handled by a pre-existing global rule
(`*, *::before, *::after { animation-duration: 0.001ms !important; ... }`)
that automatically covers every new component with no per-component work.
