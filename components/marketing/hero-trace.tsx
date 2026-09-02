const STAGES = [
  { label: "Document arrives", detail: "HR file uploaded, EP-114" },
  { label: "Value extracted", detail: "Contract wage AED 1,850, page 14" },
  { label: "Rule computes", detail: "Meets 1,600 minimum: pass" },
  { label: "Assessor confirms", detail: "R. Haddad, 09:41" },
  { label: "Finding raised", detail: "Requirement 8: partial" },
  { label: "Closure accepted", detail: "Action verified, cycle 6" },
  { label: "Recurrence detected", detail: "Same finding, cycle 7" },
] as const;

const HERO_DURATION_MS = 1600;

export function HeroTrace() {
  const step = HERO_DURATION_MS / STAGES.length;

  return (
    <div className="w-full">
      {/* Below sm: a vertical timeline, so nothing depends on horizontal scroll on a phone. */}
      <ol className="relative flex flex-col gap-6 pl-5 sm:hidden">
        <div className="absolute left-[7px] top-[7px] bottom-[7px] w-px bg-hairline" />
        <div
          className="hero-trace-line-vertical absolute left-[7px] top-[7px] bottom-[7px] w-px bg-accent"
          aria-hidden
        />
        {STAGES.map((stage, index) => (
          <li key={stage.label} className="relative">
            <span
              className="hero-trace-dot absolute -left-5 top-1 h-[15px] w-[15px] rounded-full border border-hairline bg-surface"
              style={{ animationDelay: `${Math.max(index * step - 60, 0)}ms` }}
              aria-hidden
            />
            <span
              className="hero-trace-detail block text-sm font-medium text-ink"
              style={{ animationDelay: `${index * step + 120}ms` }}
            >
              {stage.label}
            </span>
            <span
              className="hero-trace-detail mt-1 block text-xs leading-snug text-ink-secondary"
              style={{ animationDelay: `${index * step + 200}ms` }}
            >
              {stage.detail}
            </span>
          </li>
        ))}
      </ol>

      {/* sm and up: the full horizontal trace. */}
      <div className="relative hidden pt-2 sm:block">
        <div className="absolute left-0 right-0 top-[7px] h-px bg-hairline" />
        <div
          className="hero-trace-line absolute left-0 right-0 top-[7px] h-px bg-accent"
          aria-hidden
        />
        <ol className="relative grid grid-cols-4 gap-4 lg:grid-cols-7">
          {STAGES.map((stage, index) => (
            <li key={stage.label} className="flex flex-col items-start">
              <span
                className="hero-trace-dot h-[15px] w-[15px] rounded-full border border-hairline bg-surface"
                style={{ animationDelay: `${Math.max(index * step - 60, 0)}ms` }}
                aria-hidden
              />
              <span
                className="hero-trace-detail mt-3 text-sm font-medium text-ink"
                style={{ animationDelay: `${index * step + 120}ms` }}
              >
                {stage.label}
              </span>
              <span
                className="hero-trace-detail mt-1 text-xs leading-snug text-ink-secondary"
                style={{ animationDelay: `${index * step + 200}ms` }}
              >
                {stage.detail}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="sr-only">
        Sequence: document arrives, value extracted, rule computes, assessor confirms, finding
        raised, closure accepted, recurrence detected in the next cycle.
      </p>
    </div>
  );
}
