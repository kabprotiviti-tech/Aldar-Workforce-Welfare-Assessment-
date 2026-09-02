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
