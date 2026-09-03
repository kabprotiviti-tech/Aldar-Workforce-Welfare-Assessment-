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

## Entity and assessment management

**Subject-code audit numbers: full audits are whole numbers, a follow-up is
the whole number below it plus .5 — and the numeric suffix is omitted only
at audit number 1.** CONTEXT.md's own example sequence "..., 3, 3.5, 4"
under-specifies the general rule; `lib/scheduling/subject-code.ts`'s
`nextAuditNumber` reproduces it as `floor(last) + 1` for a full audit and
`floor(last) + 0.5` for a follow-up, which is the only reading that also
reconciles CONTEXT.md's two worked examples — the suffixed
`2023-EP-FU-GLIS-3.5` next to the unsuffixed `2022-ACM-FU-DIC` — as "the
suffix appears whenever audit_number isn't 1," not "whenever the type is
FU." A second follow-up requested before the next full audit would
collide with the first (both `floor(x) + 0.5`); this isn't handled
specially — it's caught by `assessments.subject_code`'s own unique
constraint rather than silently mis-numbered, since the brief doesn't
define what a second consecutive follow-up should be numbered.
`audit_number` widened from `integer` to `numeric(5,1)`
(0012_visit_schedule.sql) to hold the `.5`.

**For Accommodation, the subject code's ENTITYCODE component is the
facility_code, not the entity_code.** Accommodation assessments are
per-facility (95 facilities/cycle, CONTEXT.md), and a facilities-management
entity can operate many facilities — using entity_code there would give
every one of that entity's facilities an identical, colliding subject
code. Employment Practices/Onboarding (entity-level, no facility) use
entity_code as before.

**Three visit dates, not two.** The brief distinguishes a proposed date
(the consultancy's initial offer), a confirmed date (once agreed — may
differ from the proposal), and the actual visit date (may differ again,
e.g. a reschedule) — three genuinely different facts, only two of which
0004_assessments.sql had a column for. `planned_visit_date` is renamed to
`proposed_visit_date` and `confirmed_visit_date` is added
(0012_visit_schedule.sql); `report_due_date` is computed only from
`actual_visit_date`, the one date that's actually knowable to have
happened.

**permission_required is copied onto the assessment at generation time,
not read live from the facility.** A specific visit's permission status is
a scheduling fact about that visit; if a facility's own
`access_permission_required` flag is corrected later, that shouldn't
silently rewrite the permission status of a visit already being
scheduled. The access letter itself reuses `evidence_files` (with
`document_class = 'access_letter'`) rather than a dedicated column/table —
it's an uploaded document like any other evidence, and the schema already
has a place for exactly that. Uploading it requires a Storage bucket named
`evidence` to exist in the Supabase project (created once via the
dashboard, or a project-specific storage migration this repo doesn't have
— the local Postgres test harness has no `storage` schema to migrate
against, so this path is exercised by type-checking and build only, not a
DB test, the same limitation every other Supabase-only feature in this
repo has without a live project).

**UAE working week: Saturday/Sunday weekend, not the older Sunday-Thursday
week.** The brief says "UAE working week" without specifics. The UAE
government moved to a Monday-Friday workweek (Friday counted as a working
day for deadline purposes) in January 2022; `lib/scheduling/working-days.ts`
uses that, current, calendar. `public_holidays` (0013_public_holidays.sql)
is seeded with only the fixed-Gregorian-date holidays (New Year's Day,
Commemoration Day, National Day) — the Islamic-calendar ones (Eid al-Fitr,
Eid al-Adha, Islamic New Year, Prophet Muhammad's Birthday) are set by moon
sighting and officially announced only shortly beforehand, so guessing
exact future dates for them would be inventing content the same way this
session has refused to invent regulatory clause text elsewhere. That's
exactly why the table is admin-editable in Settings rather than a
hard-coded constant.

**report_due_date is computed once, at the moment actual_visit_date is
recorded, against the holiday calendar as it exists then.** "Stored, not
calculated on read" (this prompt) applies to the holiday table too, not
just the arithmetic: a holiday added to Settings afterward does not
retroactively change a deadline already stored.

**generateAssessmentSet is built as a small, explicit port
(GenerateCycleDb) with two adapters, not a function that takes a Supabase
client directly.** The "95 facilities under 5 seconds" acceptance
criterion is a property of a *fixed* number of round trips (5: active
targets, active template, existing-in-cycle, history, one bulk insert)
regardless of N, not of anything that scales with N — the whole point of
the design. Isolating the four reads + one write behind an interface let
that be proven twice: `generate-cycle.test.ts` proves it architecturally
with a call-counting fake adapter and a synthetic 95-target run;
`tests/db/generate-cycle.perf.test.ts` proves the acceptance criterion
literally, seeding 95 real facilities in the local Postgres harness and
timing a real RLS-scoped `generateAssessmentSet` call end to end (well
under the 5-second budget in practice). The real app uses
`supabaseGenerateCycleDb`, the same interface against a real
(RLS-subject) Supabase client.

**previous_assessment_id links only to an *approved* prior assessment;
audit-number sequencing counts every prior assessment, approved or not.**
These are deliberately different lookups. Carry-forward reporting
(CONTEXT.md) needs a previous report that was actually approved — an
in-progress draft has nothing reliable to carry forward. Numbering, by
contrast, has to reflect how many audits have actually been attempted,
approved or not, or two audits in the same cycle could collide on the same
number.

**Nav gets two new top-level items, Entities and Cycles.** The shell's nav
list was specified verbatim in an earlier phase, but entity/facility/cycle
management is core operational data with nowhere else to live in that
structure — hiding it behind "Settings" would misrepresent what it is.
Added between Overview and Assessment Programmes, the natural reading
order (master data, then the programmes that consume it).

**CSV import is fail-closed and non-transactional.** Any row-level
validation error (`lib/scheduling/csv-import.ts`) stops the whole import
before a single row is written — a partial import of the client's annual
list is worse than no import. Given that guard, the actual writes
(entities upserted by `entity_code`, contacts matched by
(entity_id, lower(email) or lower(name)) and updated in place or inserted)
are not wrapped in a single database transaction — Supabase's REST API has
no multi-table transaction primitive, and this is an infrequent,
human-supervised annual upload, not a hot path where that risk matters
enough to justify a database function instead. A hand-rolled RFC4180-ish
parser is used instead of a dependency — quoted commas/newlines/escaped
quotes are the only real complexity, small enough to own directly and unit
test exhaustively (18 test cases covering exactly those edge cases).

## Request-for-information flow

**A checklist line is one (document type, requirement) pair, not one
document type.** The brief says a document type "names the
requirement(s) it evidences" (plural) and separately requires an
evidence_files row "linked to the assessment and the requirement"
(singular) on upload. The only way to satisfy both without ambiguity is
for `rfi_checklist_items.requirement_id` to be not-null and for one
document template that evidences several requirements to produce several
checklist lines when an RFI is issued — one per requirement — all sharing
the same `document_template_id` so the UI can still group them. The
alternative (one line per template, requirement chosen arbitrarily at
upload time) would leave "linked to ... the requirement" undefined
whenever a template evidences more than one.

**The uploader is fixed to the RFI's own contact, never anything the
uploader submits.** "The uploader recorded as the entity contact" (this
prompt) is satisfied by `lib/rfi/portal.ts`'s `recordUpload` reading
`contact_id` off the `rfi_requests` row the checklist item belongs to —
not from any field in the upload request. A portal visitor has no
account and could self-report any name; fixing it server-side to the
contact the RFI was actually issued to is what makes the recorded
uploader trustworthy rather than merely present. This also required
widening `evidence_files.uploaded_by` to nullable and adding
`uploaded_by_contact_id` (0015_evidence_files_rfi_and_nda.sql) — the
column was `not null references auth.users`, and a portal upload has no
Supabase user at all.

**Only a token's hash is ever stored, and the whole portal runs on the
service-role client.** `rfi_tokens.token_hash` is a SHA-256 of the raw
token (`lib/rfi/token.ts`) — the same reasoning as a password hash: a
database read (a backup, a bug, an insider) should never be enough to
reconstruct a working link. Consequently a portal visitor has no
Supabase session to apply RLS to, so `rfi_tokens` and
`rfi_token_access_log` carry **no RLS policies at all** (0014_rfi.sql) —
every portal read/write goes through `lib/rfi/portal-supabase.ts`'s
service-role adapter, the same pattern 0005_evidence_ai.sql already
established for `extractions`/`ai_observations`. One real, permanent
consequence: staff cannot retrieve or resend a previously issued RFI's
link — re-issuing generates a new token. Acceptable for what this is (a
short-lived access credential, not a record), and made explicit in the
intake dashboard.

**checkPortalAccess/submitPortalUpload are pure orchestration over a
small RfiPortalDb port, kept in a separate file from the Supabase
adapter.** Same reasoning as `lib/scheduling/generate-cycle.ts`'s
GenerateCycleDb: the acceptance criteria ("expired or tampered token
returns 403 and is logged," "uploading ... creates an evidence_files row
linked to the assessment and the requirement, with the uploader recorded
as the entity contact") are about this logic's behaviour, not about
Supabase Storage bytes. `lib/rfi/portal.ts` has zero "server-only"
imports and zero Supabase-client construction, so
`tests/db/rfi-portal.test.ts` can import it directly and exercise the
real logic against a real local Postgres instance with a hand-rolled
`pg`-backed adapter — proving both acceptance criteria literally, not by
inference from a mock. The real Supabase adapter
(`lib/rfi/portal-supabase.ts`) is a separate file specifically so
importing it (which pulls in "server-only" and `lib/supabase/admin.ts`)
never happens as a side effect of testing the orchestration.

**Rate limiting is checked before token validity, against the same
token hash, using a persisted access log — not an in-memory counter.**
A serverless route handler has no reliable in-process memory between
requests, so the sliding-window count (`lib/rfi/token.ts`'s
`isRateLimited`, 20 attempts / 10 minutes) reads `rfi_token_access_log`
rows written by every prior attempt, valid or not. Checking the rate
limit first means a flood of guesses against one hash never even reaches
a token lookup once the limit is hit.

**RFI due date is 14 *calendar* days, not working days.** The brief's
`report_due_date` rule explicitly says "working days"; this one doesn't
say either way, and re-using UAE working-day arithmetic here would be
inventing a constraint the brief didn't state. Calendar days from
issuance (the one receipt-adjacent date this system actually controls —
"from receipt" is read as receipt of the RFI itself, since when the
recipient opens the email isn't something the system can observe).

**The reminder schedule fires once per milestone, not daily while
overdue.** `lib/rfi/reminders.ts`'s `reminderKindForDueDate` returns
"overdue" for every day after the due date, but the caller only ever acts
on it once — `rfi_reminders_sent`'s `unique(rfi_request_id, kind)`
constraint is the actual dedupe mechanism (insert either succeeds once or
hits a unique violation, race-safe in a way a separate select-then-insert
wouldn't be under a scheduler that might overlap runs), not application
bookkeeping. The brief lists three milestones, not an escalating daily
nag.

**Email and virus scanning are both stub implementations behind a
swappable interface — no provider credentials exist in this project for
either.** The brief explicitly sanctions this for the virus scanner
("stub is acceptable for MVP, wired so it can be swapped for a real
scanner"); `lib/email/send.ts` gets the identical treatment for the same
reason (no email provider API key in `lib/env/server.ts`, and inventing
one isn't this repo's call to make). Both are single-function interfaces
(`EmailSender.send`, `VirusScanner.scan`) with one production call site
each, so swapping in a real provider later touches one file, not the
callers.

**The reminder cron endpoint (`app/api/rfi/reminders`) fails closed on a
missing secret, and is exercised by type-checking/build only, not a DB
test.** It's triggered by Vercel Cron (`vercel.json`), not a signed-in
user, so `CRON_SECRET` (optional in `lib/env/server.ts` — a deploy without
one configured yet shouldn't fail to boot) is the only thing gating it;
with it unset, every request is rejected rather than the schedule running
unauthenticated. Its actual send path
(`lib/rfi/send-reminders.ts`) goes through the real Supabase-js
service-role client, which the local Postgres test harness has no
`storage`-adjacent equivalent for — the same limitation the access-letter
upload and RFI-portal Storage calls already have, documented above and
in the entity/assessment management phase's decisions.

**NDA confirmation unlocks an entity's evidence for every viewer, not
per-viewer or per-session.** The brief says "require the assessor to
confirm an NDA is in place," singular — read as a fact about the entity
(a real NDA either exists or it doesn't), not a per-person acknowledgment
each staff member repeats. `entities.nda_confirmed_at`/`nda_confirmed_by`
record only the most recent confirmation; `components/app/nda-gate.tsx`
gates on whether *any* confirmation exists, not on who gave it.

## Evidence handling

**Server-side signed upload, not a proxied file body.** This prompt asks
for "server-side signed upload" specifically because a 40-50MB request
body through a Vercel serverless function would risk (or outright hit)
the platform's own body-size limit. `lib/evidence/actions.ts`'s
`requestEvidenceUpload` validates and classifies from metadata alone
(filename/mime/size — no bytes), confirms via a normal RLS-scoped read
that the caller can actually see the target assessment (the real
authorization check, before Storage is ever touched), then issues a
signed upload URL through the service-role client. The browser PUTs the
file directly to Supabase Storage with that URL — the file's bytes never
pass through this app's server at all.

**Rejection is extension-based, not mime-based.** "Reject anything else
with a clear message" needs a reliable signal, and the browser-reported
mime type isn't one — the same `.xlsx` can arrive as the correct
spreadsheet mime type, `application/octet-stream`, or something else
entirely depending on the OS's file-type association, which would make
mime-based rejection either too strict (false rejects) or too loose
(useless). `lib/evidence/upload-validation.ts` gates on the file
extension alone; the Storage bucket's own `allowed_mime_types`/
`file_size_limit` config (0016_evidence_bucket.sql) is a second,
independent layer of defense at the Storage API itself, not the primary
or only check, and can't produce this prompt's "clear message" on its
own (a Storage-layer rejection is a generic API error, not application
copy).

**0016_evidence_bucket.sql is excluded from the local Postgres test
harness.** It configures `storage.buckets`/`storage.objects`, which exist
only in a real Supabase project — the same limitation every other
Storage-touching migration and code path in this repo already has
without a live project (documented in the entity/assessment management
and RFI phases' decisions above). `lib/evidence/upload-validation.ts` and
`lib/evidence/classify.ts` are proven by unit tests instead, since they
need no Storage or database access at all — that's the whole reason
they're pure functions taking plain metadata rather than a File object or
a Supabase call.

**"xlsx" (the SheetJS npm package) was evaluated and rejected — used
"read-excel-file" instead.** `npm audit` flagged two unpatched high-
severity advisories (prototype pollution, ReDoS) with no fix available
on the registry; SheetJS moved patched releases to their own CDN rather
than npm, which isn't a source this project pulls dependencies from.
Since this app parses spreadsheets from files third parties can supply
(directly, or indirectly via the RFI portal), shipping a library with a
known, unpatched parser vulnerability was not an acceptable trade for
convenience. `read-excel-file` (0 known vulnerabilities, browser-native)
does the same job for the spreadsheet table view.

**PDF pagination for a 40MB file uses the browser's own PDF viewer, not a
custom pdf.js integration.** The acceptance criterion ("uploads, previews
and paginates without freezing the browser") is exactly the failure mode
a naive custom renderer risks — rendering every page of a large scanned
PDF into canvas elements up front. An `<iframe src={signedUrl}>` hands
the whole job to the browser's native, battle-tested PDF renderer
(Chrome/Firefox/Safari all ship one), which streams and paginates the
document itself. This also means no pdf.js dependency was needed at all.
The spreadsheet preview caps at 500 rendered rows for the same
freeze-avoidance reason, for a pathologically large sheet.

**Coverage is computed from evidence_file_requirements, scoped to one
assessment's own template — not globally, and not from
evidence_files.requirement_id.** "Coverage" only means something against
the specific checklist an assessment is being measured on.
`evidence_files.requirement_id` (added in the RFI phase) is upload-time
provenance for one specific document — the one requirement an RFI
checklist line was issued for, immutable once set. Coverage needed a
different, assessor-editable, genuinely multi-valued relationship, so it
gets its own join table rather than overloading that column's meaning.

**document_class stays free text at the database layer; the 14-value
business vocabulary is enforced only at the app boundary.** Two
administrative sentinel values (`access_letter` from the earlier
assessment-management phase, `rfi_upload` from the RFI phase) already
occupy this column outside the classifier's vocabulary — a `check`
constraint listing all 16 values would misrepresent two of them as
"business document classes" they aren't. `documentClassSchema`
(`lib/db/evidence.ts`) is the fixed vocabulary the classifier proposes
from and the evidence library's dropdown is scoped to; this is the same
"left unconstrained rather than guessing a full enum" reasoning
0003_templates.sql already uses for `questions.answer_type`.

**Filenames are normalized (`_`/`-`/`.` → space) before running the
classifier's keyword rules.** Regex `\b` word-boundary matching (used for
short tokens like "wps") doesn't treat an underscore as a boundary — it's
a `\w` character — so `\bwps\b` alone would silently never match
"WPS_Report.pdf", the most realistic real-world filename shape. Caught by
the classifier's own unit tests before shipping, not discovered later.

## Document extraction service

`lib/ai/` (client, prompts, orchestration, queue) plus
`app/api/ai/*` and the Evidence Library's extraction controls. Sends PDFs
and images to Claude to extract structured facts — never a compliance
conclusion, never arithmetic (CONTEXT.md rules 2/3) — with every call
persisted and every fact fanned out as `proposed`, exactly as CONTEXT.md
rule 4 already requires for `extracted_facts`.

**The SDK's own retry, not a hand-rolled loop.** "Retry with exponential
backoff on 429 and 5xx" (this prompt) is exactly what
`@anthropic-ai/sdk`'s `maxRetries` option already implements — backoff
with jitter on 408/409/429/5xx and connection errors, documented in the
SDK itself. `lib/ai/client.ts` sets `maxRetries: 4` and a 120s per-call
timeout rather than reimplementing that loop; reimplementing it would
only risk diverging from the SDK's own understanding of which errors are
retryable.

**Zod bumped 3.23.8 → 3.25.76, not to zod 4.** `@anthropic-ai/sdk`
declares `zod: "^3.25.0 || ^4.0.0"` as an optional peer. 3.25.76 is the
last 3.x release, satisfying the SDK without crossing a major version
against this codebase's extensive existing zod 3 schemas — the full test
suite (158/158 at the time) passed unchanged after the bump, confirming
nothing broke.

**App-boundary Zod validation is the primary defense against a malformed
model response, not Anthropic's structured-output config.** The
acceptance criterion is "a malformed model response never crashes the
request... stored with the error and surfaced as 'extraction failed,
review manually'" — that needs real parsing and validation code with a
provably-exercised failure path, not an API feature that would reduce
(without eliminating, or testing) how often malformed responses occur.
`lib/ai/extract.ts`'s `tryParseModelJson` never throws; a schema
mismatch, an off-vocabulary `fact_key`, or a `value: null` fact missing
its `reason` are all caught by `responseSchema.safeParse` and stored as a
failed extraction, proven by `lib/ai/extract.test.ts`'s "malformed
responses never crash" suite against six distinct malformed shapes.

**Forbidden fields (`status`/`rating`/`compliant`/`score`) are checked
recursively against the parsed JSON's *keys*, before schema validation —
not filtered out of the response afterward.** Silently dropping a
forbidden field would let a model that tried to sneak in a compliance
judgment succeed at everything except that one field being invisible;
rejecting the whole extraction as failed is the only response consistent
with "the model must never set compliance status" being a hard rule, not
a preference. Checked against keys, not string values, so a fact whose
*value* happens to contain the word "status" (e.g. a verbatim quote) is
never mistaken for the model returning a forbidden field
(`lib/ai/forbidden-fields.test.ts`).

**`extracted_facts.confidence`/`verbatim_quote`/`reason`/`value_boolean`/
`value_json` didn't exist when `0005_evidence_ai.sql` first created the
table** (`confidence` was `numeric`, no fixed vocabulary existed yet).
`0018_extracted_facts_shape.sql` alters the table in place rather than
adding a parallel v2 table, safe because no live Supabase project has
ever run against this schema — the same reasoning already used for
`0009_template_immutability.sql`'s trigger-based approach and other
in-place alterations earlier in this session.

**`offer_letter_allowance_value` has no dedicated `document_class`** — it
is bundled into the `employment_contract` prompt
(`lib/ai/prompts/employment_contract/v1.ts`), which recognizes either a
signed contract or an offer letter and reports whichever fact applies.
The 20 given fact keys map cleanly onto 12 of the 14 document classes;
inventing a 15th class for one fact key not called for in the brief
would have been scope creep the brief didn't ask for.

**`worker_register` and `photo` get no v1 prompt at all.** The brief
gave zero fact keys for either and said "extend later" — fabricating
plausible-sounding fact keys for them would violate "extract only what
is present" one level up, inventing facts to extract rather than
inventing values. `lib/ai/prompts/registry.ts` simply has no entry for
either; `extractDocument` returns `{outcome: "skipped"}` without ever
calling the model, and the queue records that as a failed job with a
clear reason (no separate "skipped" job status exists — see
`extraction_jobs` in docs/schema.md) rather than crashing or silently
dropping the document.

**No live `ANTHROPIC_API_KEY` in this sandbox, so the "golden-file" test
is a fully mocked, deterministic exercise of the real orchestration, not
a live-API test.** `lib/ai/extract.test.ts` injects a fake `ExtractionDb`
and a `CallClaudeFn` returning canned per-class JSON fixtures, then runs
the actual `extractDocument` parsing/validation/fan-out logic against
them — proving the three fixture documents (`wps_report`,
`payroll_register`, `insurance_schedule`) produce exactly their expected
fact keys, and that six distinct malformed-response shapes fail cleanly.
This is a real gap against "three fixture documents" read literally as
binary files through a live model call; it is the best verifiable
substitute available without live credentials, and is a scope limitation
worth re-testing against the real API once a key is available.

**The extraction queue's atomic claim is a Postgres function
(`claim_next_extraction_job`, `0020_claim_extraction_job.sql`), not
application-level locking.** `FOR UPDATE SKIP LOCKED` inside a
`security definer` function makes "claim the oldest queued job and mark
it running" a single round trip instead of a read-then-write race across
two separate PostgREST calls — the real risk being the stuck-job sweep
re-triggering a batch whose background run is technically still
in-flight. Proven directly against real Postgres (not mocked) by firing
two concurrent `claimNextJob` calls in `tests/db/extraction-queue.test.ts`
and asserting they never return the same job.

**A batch drains sequentially, one document at a time, not in
parallel.** `lib/ai/queue.ts`'s `runBatch` loops `processNextJob` to
completion rather than claiming and processing several jobs at once.
Keeps a single background run (`next/server`'s `after()`) within one
predictable concurrency budget against the Anthropic API instead of
needing a separate limiter for up to 18 simultaneous requests — the
trade is a slower batch, which the UI's progress bar makes visible and
tolerable, for less complexity and a smaller blast radius if the API
starts rate-limiting.

**The stuck-job sweep (`app/api/ai/sweep-stuck-jobs`, Vercel Cron every 15
minutes) requeues *and* re-triggers processing, not just requeues.**
`next/server`'s `after()` extends a serverless invocation's lifetime only
for the request that scheduled it — a batch's background run getting
killed mid-document by a duration limit leaves its job "running" forever
with nothing left calling `claimNextJob` for that batch. Resetting the
job's status to `queued` alone would leave it queued forever too; the
sweep resumes `runExtractionBatch` for every batch it touched, the same
way starting a batch does. The 10-minute stuck threshold is comfortably
above `lib/ai/client.ts`'s own 120-second per-call timeout, so a job
still genuinely in flight is never mistaken for a stuck one.

**Route handlers, not Server Actions, for the batch endpoints.** Server
Actions in this codebase (`lib/*/actions.ts`) return a result object to
the calling component; starting a batch needs to return immediately after
queuing while `next/server`'s `after()` keeps draining it in the
background, and progress needs to be polled from the client on an
interval — both are a natural fit for `POST`/`GET` JSON endpoints
(`app/api/ai/batches`, `app/api/ai/batches/[id]`), not a form-bound
mutation. Authorization still goes through the same session-scoped
Supabase client and RLS as every Server Action in this codebase; only the
queue write itself (no `authenticated` insert grant on `extraction_jobs`,
matching `extractions`/`extracted_facts`) uses the service-role client,
after RLS has already confirmed the caller can see the assessment's
evidence files.

**UI extraction/build verification never exercised a live Supabase
project, same limitation as every earlier phase in this session.**
`npx tsc --noEmit`, `eslint`, `npm run build` plus the postbuild secret
scan, and the full Vitest suite (including the two new DB-backed suites
against local Postgres) all passed, but the Evidence Library's new
"Extract facts"/"Extract all" buttons, progress bar, and cost display
were never clicked through in a browser against a real backend — there
is no live Supabase project in this sandbox to sign into. The route
handlers, queue, and extraction orchestration are proven instead by the
DB-backed queue test (`tests/db/extraction-queue.test.ts`, real Postgres,
real `claim_next_extraction_job` SQL function) and the mocked
`extract.test.ts`/`queue.test.ts` suites.

## Fact ledger

`lib/facts/`, `components/facts/fact-ledger.tsx`,
`supabase/migrations/0021_fact_ledger.sql`. The human gate between
extraction and everything downstream (this prompt). CONTEXT.md rule 4
already said nothing reaches a report without a person confirming it;
this phase is what makes that structurally true instead of a convention
every future query has to remember.

**The guarantee is a view that withholds columns, not just a WHERE
clause.** `fact_ledger_confirmed` filters to `accepted`/`edited`, and it
also refuses to expose the raw `value_text`/`value_number`/... columns or
`resolved_value_json`. That second part is the one that matters: a view
that filtered rows but re-exposed the model's original value columns
would still let a consumer read the *superseded* proposal of an edited
fact, or re-implement the "edited wins" precedence and get it wrong. One
`confirmed_value` column, already resolved, is the only value there is to
read. `security_invoker = true` because Postgres's default for views is
owner rights, which would have quietly bypassed the staff-only RLS on
`extracted_facts`/`evidence_files` underneath.

**"The only read path" is enforced by a test that walks the filesystem,
with a two-file allowlist.** `tests/read-path.test.ts` fails if any module
under `app/`, `components/`, `lib/` or `scripts/` queries
`extracted_facts`, except `lib/ai/extract-supabase.ts` (which writes the
rows) and `lib/facts/ledger-supabase.ts` (the ledger itself — showing a
person unreviewed facts is precisely its job). It walks the filesystem
rather than `git ls-files` because a file that hasn't been committed yet
is exactly the one most likely to have just introduced a second read
path. The guard was verified by temporarily adding a violating query and
confirming the test failed on it. This is also why the evidence page's
per-file fact count moved out of an inline query and into
`listFactsForEvidenceFiles` — one read owner, no exceptions.

**Resolution and its audit row are one database transaction, so the port
has no "write audit" method to forget.** "Every accept/edit/reject writes
to audit_log" can't be guaranteed by a Supabase client that updates
`extracted_facts` and then inserts into `audit_log`: PostgREST has no
cross-table transaction, so there is a window where the status changed
and the log entry didn't. `resolve_extracted_fact` does both in one call
(0021_fact_ledger.sql), which is why `FactLedgerDb`
(`lib/facts/resolve.ts`) exposes only `getFacts` and `resolveFact` — no
implementation of that interface, and no caller of it, can change a
fact's status without recording who did it. The before/after snapshots
are `to_jsonb(row)` taken inside the function rather than anything the
caller supplies, so the trail reflects the row's real state.

**The function checks `is_staff()` itself and is granted to
`authenticated`, not `service_role`.** A `security definer` function
bypasses the RLS that would otherwise be doing the authorization, so
granting it broadly without an internal check would have let a
`client_viewer` accept facts — a privilege escalation straight through
the human gate this phase exists to build. Granting it to
`authenticated` (rather than running it as a service role) also means
`auth.uid()` inside the function is the actual assessor, so `resolved_by`
and the audit actor are the real person. Both properties are tested
against real Postgres, including the negative case
(`tests/db/fact-ledger.test.ts`).

**Bulk accept re-checks confidence server-side and resolves each fact
individually.** "Bulk accept only for facts with high confidence... and it
must still record an individual action row per fact" (this prompt) has
two failure modes, and neither is prevented by UI alone: a request could
carry ids the client believed were high confidence, and a batch UPDATE
would produce one audit row for the lot. `bulkAcceptHighConfidence`
re-reads every id from the database, applies `isBulkAcceptable` to the
stored row, and then calls the single-fact path once per fact. Tested
both ways — the client-lied case, and the one-audit-row-per-fact count.

**An edit stores the human value in `resolved_value_json` rather than
overwriting the model's `value_*` columns.** The verbatim quote and page
reference are only meaningful next to what the model actually proposed;
overwriting the proposal would leave a quote that no longer matches the
value beside it, and would destroy the before-state the audit trail
needs. The review list shows both ("Model proposed: 42") for an edited
fact.

**An edited value is coerced to the proposed value's type.** An edit
arrives from a text input as a string, but the rule engine will later
compare these values numerically or as dates. `coerceEditedValue`
(`lib/facts/ledger.ts`) parses the human's text against the type the
model proposed, so editing a count from 42 to 43 stores the number 43,
not the string `"43"` — a type drift that would have silently broken
downstream comparisons. It also refuses an empty edit: an assessor who
believes there is no value should reject the fact with a reason, because
a null "confirmed" value would be consumed downstream as a real,
human-confirmed absence.

**Bounding boxes: the column and the UI path exist, but the v1 prompts
don't ask the model for coordinates.** This prompt says "highlights the
region **if a bounding box is available**". Asking a model to invent pixel
geometry for a scanned page produces confident nonsense — plausible
numbers pointing at the wrong place, which is worse than no highlight at
all, because a highlight is a claim about provenance. So `bbox` is
nullable, validated at the boundary with `factBboxSchema` (a malformed
box is dropped rather than rendered), and the image preview draws the
overlay when a box is genuinely present. A real coordinate source (an OCR
pass, a future tool-use response) can fill it with no schema change.

**Clicking a fact navigates a PDF to its page; it cannot highlight a
region inside one.** The PDF preview is the browser's own viewer in an
iframe (chosen in the evidence-handling phase so a 40MB scan doesn't
freeze the tab), and nothing can draw over its internal rendering.
`#page=N` — the standard PDF open parameter every native viewer honours —
is therefore what "scrolls the preview to that page" means for a PDF, and
a bounding box on a PDF narrows to its page while the verbatim quote in
the ledger does the rest. Region highlighting is real for images, where
the app renders the `<img>` itself. The page number is part of the
iframe's React `key` because a hash-only `src` change doesn't reliably
re-navigate an already-loaded iframe across browsers.

**Page references are parsed, not assumed.** `page_ref` is free text the
model wrote, so `parsePageRef` reads the shapes that actually occur
("page 1", "p. 3", "Page 5 of 40", a bare "7") and prefers a number
introduced by "page"/"p"/"pg" over a leading number belonging to
something else — "Table 3, page 5" is page 5, not page 3.

**"14 of 22 facts confirmed" counts accepted + edited, and rejected is
shown separately.** Taking this prompt's wording literally, a rejected
fact is a decision but not a confirmation, so it doesn't advance the
count. To keep that from reading as unfinished work forever, the ledger
also shows "N to review" and "N rejected" beside the required label
rather than changing it.

**A fact with an unrecognised status is treated as unreviewed.** If a
future migration adds a status this build doesn't know,
`ledgerFactFromRow` maps it to `proposed` rather than assuming it's
confirmed. The safe direction for a gate is to under-trust.

## Compliance rule engine

`lib/rules/compliance/`, `supabase/migrations/0022_rule_engine.sql`. The
13 v1 rules from this prompt, as typed functions with declared inputs, a
threshold, a legal reference and an explanation template. CONTEXT.md rule
2 says the model never performs arithmetic or comparison; this is where
that arithmetic lives.

**"No model call may occur in this module" is enforced by a test, not a
comment.** `lib/rules/compliance/no-model-call.test.ts` fails if any file
under `lib/rules/compliance/` imports `@anthropic-ai/sdk` or `lib/ai`, or
mentions `fetch`/`XMLHttpRequest`. A comment saying "no AI here" would
not survive a future edit; a failing test will.

**Kept separate from the existing `lib/rules/`.** `validation.ts` and
`aggregate.ts` (built in the first phase of this project) do a different
job: they validate an assessor's *chosen* compliance status and compute
report header metrics. These rules evaluate evidence against thresholds.
Same directory, different subfolder, no shared types — collapsing them
would have made "the rule engine" ambiguous in every future conversation.

**`insufficient_data` is never silently a pass, and says so in words.**
Every such result renders as "Insufficient data — this rule could not be
evaluated and is not a pass. Missing: `<keys>`." The phrasing is
deliberate: this text goes into an assessor's screen and a client's
report, where "no result" must not read as "no problem".
`tallyOutcomes` counts it in its own bucket, and nothing in the module
maps it onto pass or fail.

**A missing input names every missing key at once.** `requireAll`
(`lib/rules/compliance/inputs.ts`) collects all of them rather than
failing on the first, so an assessor is told everything a rule still
needs in one pass. A key counts as missing when it is absent, when its
confirmed value is null (a person confirmed the document doesn't state
it — real information, but not a value to compute with), or when it is
present in a shape the rule can't use. `false` and `0` are values, not
absences, which matters for `R08_AGENCY_CLAUSE`: a confirmed *absent*
employer-pays clause is a **fail**, not a gap.

**Displayed numbers can never contradict the verdict beside them.**
26.4 m² across 8 residents is 3.3, which prints as "3.30" — but 31.99 m²
across 8 is 3.99875, which at two decimals prints as "4.00" beside a
"Minimum 4.00 m²" it actually falls short of. `formatComparable` adds the
least precision that separates the value from the threshold ("3.999"), so
a failing figure always looks like it fails. This is a small thing that
would have destroyed trust in the engine the first time a client read it.

**Explanation templates are declared strings rendered by a strict
renderer.** `renderTemplate` throws on a token the rule didn't supply,
rather than shipping a literal `{minimum}` into a report. Templates are
also stored in `rule_definitions.explanation_template` so an admin can see
the wording a rule produces; rendering itself uses the rule's own copy,
since the tokens are the function's contract. Only thresholds (and the
citation) are the admin-editable surface — which is exactly what this
prompt specified.

**An invalid stored threshold is a configuration error, not
`insufficient_data`.** `run()` validates thresholds against the rule's own
Zod schema and returns `{ok: false, configError}`; the runner reports it
and stores no evaluation row. Two alternatives were worse: folding it
into `insufficient_data` would disguise an admin's broken threshold as
missing evidence, and silently falling back to the code defaults would
stamp the evaluation with one threshold while computing it with another.

**`run()` returns the thresholds it used, so stamping cannot drift from
the computation.** A null stored threshold means "use the rule's declared
defaults", and the value that comes back is whichever was actually
applied — the evaluation is stamped from that, never from a second read
of the definition row.

**Thresholds are seeded in SQL *and* declared in code, with a drift
test.** The table is where they live and what an admin edits; the code
carries the same values as its fallback. That is two sources of the same
numbers, so `tests/db/rule-engine.test.ts` compares every seeded row's
threshold, fact keys, quantitative keys and template against the rule's
own declarations and fails if they diverge. The alternative — seeding
`threshold = null` and keeping the numbers only in code — would have made
"thresholds live in rule_definitions" untrue.

**An admin edit supersedes; it never updates.** A new `version` row is
inserted and the previous one deactivated, a partial unique index keeps
exactly one active version per code, and a trigger makes a definition
immutable once an evaluation points at it. Editing in place would
silently rewrite the basis of every stored result. Proven end to end: the
DB test revises a threshold, re-runs, and asserts the original evaluation
row is byte-for-byte unchanged while the re-run is a new row stamped with
v2.

**Legal references name the WWAP checklist requirement and are marked
PENDING VERIFICATION.** Every `legal_reference` cites the checklist
requirement number — which is the reference we actually have — and says
plainly that the statutory citation is unconfirmed. Inventing article
numbers of UAE labour law to fill the column would put fabricated law in
front of a client, which is the one thing this column must never do. The
client's legal team supplies the real citations; the column is editable
for exactly that.

**ACM_TOILET_RATIO's ratios are placeholders and are flagged as such.**
This prompt named "CD13 2009 thresholds" but not the figures. 1 fixture
per 8 residents is seeded so the rule is executable, marked PENDING
VERIFICATION in both the migration and the `legal_reference`. They are
thresholds precisely so an admin can correct them without a code change,
and every evaluation is stamped with the ratio it used — so results
computed under a placeholder are identifiable later. **This needs
verifying against the published text before any report relies on it.**

**Rule codes decide the module and the requirement.** `R**` maps to an
Employment Practices requirement whose `sl_no` is the number in the code
(R11 -> 11, "Timely wage payment"), `ACM_**` to an Accommodation area.
That mapping is asserted in both the unit tests and the DB test, so a
future rule can't be seeded against the wrong requirement.

**Inputs no fact key exists for come from the assessor.** Working hours,
worker-register counts, division lists, fixture counts, vehicle fleets and
agency lists have no v1 extraction fact key, so they are declared
`quantitativeKeys` and read from `assessment_items.quantitative`. This is
the prompt's second permitted input source, and it keeps a rule honest
about where each number came from — `observed` records what it used.

**Rules that cover "every one of them" accept a list plus the one
extracted document.** `R19_VEHICLE_REG` and `R08_AGENCY_CLAUSE` merge the
assessor's list with the single document the model read, and refuse to
return a pass when part of that list was unreadable — the unreadable
entry might be the expired vehicle. That case is `insufficient_data` with
the reason stated, not a pass with a caveat.

**Division by zero is `insufficient_data`, not a pass or a fail.** An
empty room has no area *per resident*; a zero worker register has no
coverage ratio. These return `insufficient_data` with the reason spelled
out and no missing keys, since the figure was supplied — it just doesn't
support the arithmetic.

**100% coverage on the rule functions is a gate, not a claim.**
`npm run test:coverage` runs the module with v8 coverage at 100%
thresholds for statements, branches, functions and lines. It was verified
to fail by planting an untested branch. Adapters and the server action are
excluded — they are `server-only` I/O that cannot load in plain Vitest,
and the adapter is proven against real Postgres by
`tests/db/rule-engine.test.ts` instead. Coverage is not measured across
the rest of the codebase, where the tests that matter are behavioural.

**Boundary cases are tested explicitly, as named tests.** Exactly 4.00 m²
per resident passes; exactly 8 residents passes; a transfer on the 15th
passes; a certificate expiring *on* the assessment date fails (it does not
cover that date). Each is its own test with the boundary in the title, so
a future change that moves one of them fails loudly rather than quietly.

## Observation layer

`lib/observations/`, `lib/ai/prompts/observations/v1.ts`,
`components/observations/observation-panel.tsx`,
`supabase/migrations/0023_observations.sql`. The model writes the
narrative; code decides everything that could affect a judgement.

**The model cannot emit a compliance status, in two independent ways.**
The response schema has no such field and is `.strict()`, so a `status`
key fails validation outright — and `stripStatusLikeKeys` removes any
status/rating/compliant/score key first, recording what it removed. Both
are tested, including the schema rejecting each forbidden key by name.

**Stripping runs *before* schema validation, not after.** With a strict
schema, a status key left in place would fail the whole response and
throw away the usable narrative with it. Stripping first means a model
that adds `"status": "compliant"` still yields a valid observation — with
the key gone, the attempt logged, and the kind still set by code. Keys
are matched, never values: a narrative that mentions "the WPS batch
status column" is untouched.

**The stripping is logged to audit_log, not the console.** This is the
model attempting the one thing it is never allowed to do, so the record
has to outlive a log buffer:
`ai_observation.status_key_stripped`, with the paths and the prompt
version. It is written even when the response failed validation for some
other reason.

**The kind is a pure function of the rule outcome.** pass →
`evidence_identified`, fail → `requires_attention`, insufficient_data →
`potential_gap` (this prompt, verbatim). `kindForRuleOutcome` is the only
thing that sets it. Note that insufficient_data mapping to *potential
gap* rather than evidence-identified is the same principle the rule
engine holds: "we could not tell" is never "it was fine".

**The outcome word is deliberately not sent to the model.** The request
carries each rule's computed working but not whether it passed. The model
doesn't need the verdict to describe what the working says, and
withholding it removes the temptation to editorialise about one. Tested.

**Source references are validated against the inputs, never trusted.** A
fact key the model invented is dropped, and if nothing real is left the
observation is discarded with a reason. The one exception is a rule that
reads no facts at all (`R16_HOURS`, `ACM_TOILET_RATIO` evaluate
assessor-entered figures, so no fact key exists for their observations to
cite): there the stored rule evaluation and its working are the traceable
origin. A rule that *does* read facts must have one cited — that is
precisely the case where a plausible-sounding narrative gets untethered
from the evidence — and an unrecognised rule code must produce a real
fact or file source. This is a judgment call about the prompt's "(file,
page, fact key)" parenthetical: read absolutely literally it would
silently discard every observation for two of the thirteen rules, which
is worse behaviour than naming the evaluation as the source.

**Facts are narrowed to the keys the item's own rules declare.** An
observation about working hours has no business being handed the
insurance policy dates, and a prompt stuffed with every confirmed fact on
the assessment invites exactly the cross-contamination the source
validation exists to prevent.

**No rule results means no observations, stated rather than invented.**
Every observation's kind derives from a rule result, so an item with no
evaluations has nothing this generator can legitimately produce. It
returns that as an error and calls no model at all.

**An assessor's own observation is stored `confirmed` and authored
`assessor`.** It needs no validation by the person who just wrote it, and
it goes straight to the workspace. Keeping `authored_by` distinguishable
matters for the report and the audit trail — "the platform said" and "the
assessor said" are not the same claim.

**Rejected observations are retained with their reason.** The row stays
and the status changes, so a later reader can see what was proposed and
why it was refused. The reason is required by the server action rather
than a check constraint, since the column must stay null for every other
status.

**The standing notice is a shared constant, rendered above the list.**
"Observations require assessor validation. The platform does not set
compliance status." lives in `lib/observations/store.ts` so the panel and
the tests state it identically, and it is rendered before any observation
so it is read first — not in a dismissible toast.

**Workspace visibility is a status filter in the query, not a caller's
discipline.** `listConfirmedObservations` filters to `confirmed`;
`open` is excluded as well, since an unreviewed narrative is a proposal
and the workspace is where the assessment is made. Proven on real rows,
including that a rejected one is retained but invisible, and that the
query is scoped to one requirement's own item.

## The assessment screen

`app/app/assessments/[id]/requirements/[itemId]/`, `lib/assessment/`,
`supabase/migrations/0024_assessment_decision.sql`. One page per
requirement, where the assessment is actually made.

**The status guarantee is a trigger, not an RLS policy.** This prompt
asks to prove that "a status cannot be written by any code path other
than an authenticated assessor action" with a test that attempts a
service-level write and fails — and RLS cannot deliver that, because the
service-role client and the table owner both bypass it by design. A
policy would have been a promise the app's own privileged code could
break at any time. The trigger binds every writer equally, and the test
attempts the write through the admin pool (the table owner, connecting as
a superuser) and watches it fail.

**The trigger also stamps and audits, so neither can be forgotten.**
`decided_by`/`decided_at` come from `auth.uid()` inside the trigger, and
the `audit_log` row is inserted in the same transaction as the decision.
"Saving a status writes decided_by and decided_at and an audit_log row"
is then true of every code path that ever sets one, including ones not
written yet.

**Two triggers, not one: insert as well as update.** A row created
already carrying a status would have been a way straight around an
update-only guard.

**It fires only on a status change.** Drafting, detail capture and
carry-forward housekeeping are untouched — a background job or a service
path can still autosave, which matters because the autosave path is
deliberately unprivileged.

**Three layers catch three different callers, and the test says which.**
RLS filters a `client_viewer`'s update to zero rows before the trigger
runs; the trigger catches a `qa_reviewer`, who passes `is_staff()` and so
passes RLS but fails `can_write_operational()`; and the trigger catches
the unauthenticated service path. The test asserts the *outcome* for the
viewer (no status written) rather than which layer caught it, and covers
the qa_reviewer case separately so the trigger's own check is genuinely
exercised.

**Drafts autosave to the server, not to localStorage.** "Draft text
survives a browser refresh" is met by the text genuinely living in the
database and being rendered from it on load — which also survives a
crashed tab, a closed laptop and a different device. The autosave is
debounced at 1.5s and skips the first render, so opening a page to read
it doesn't stamp `draft_updated_at` for someone who only looked.

**Interview notes are a separate table with no client_viewer policy.**
"Stored separately and never included in the entity-visible report" is
not a convention attached to a column here. A client_viewer's own session
returns zero rows, proven in the DB test, and the report builder would
have to deliberately join a table it has no reason to touch. Workers
spoke to an assessor in confidence and the assessed entity is the party
they may most need protection from — so the guarantee is structural.

**Validation is reused, not reimplemented.** The remark and
closure-action rules are `lib/rules/validation.ts`'s `validateRatedEntity`
from the first phase of this project. `lib/assessment/decision.ts` adds
only what this screen needs: naming the requirement in the message
("Requirement 11 (Timely wage payment): ..."), and turning items into the
navigation's completion state. A second copy of the compliance rules
would be a second place for them to drift.

**"Incomplete" is a distinct navigation state from "not started".** A
status chosen but the required remark still missing is exactly what an
assessor loses track of across 23 requirements, and it is invisible from
the status alone.

**A missing status is itself a validation issue.** An unrated requirement
is not a finished one, and the aggregate percentages would otherwise
silently exclude it.

**Specific detail is structured jsonb, not prose.** Salary transfer
dates, deduction examples with amounts, and sample sizes as "12 of 120"
— validated by a Zod schema at the boundary, and rendered back on the
page so an assessor can see what the report will actually contain. A
column per kind would have been a wide table of mostly-null columns; the
shapes differ per requirement and will grow.

**The page renders the rule working, not a verdict.** Each rule result
shows its computed explanation and its legal reference; observations show
their narrative and source. The status control is empty until a person
fills it, and the statement "Final assessment decisions are made by the
assessor." sits next to that control rather than in a footer.
