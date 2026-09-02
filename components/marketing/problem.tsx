const POINTS = [
  {
    title: "Findings recur.",
    body: "Nothing tracks whether last cycle's action was actually closed, so the same finding turns up again a year later, unconnected to the last one.",
  },
  {
    title: "Evidence scatters.",
    body: "A photo from a site visit, a payslip attachment, a screenshot forwarded twice. It arrives by email and rarely survives the cycle it was collected for.",
  },
  {
    title: "Reports get rebuilt by hand.",
    body: "Numbers move from a spreadsheet into the client's report template one cell at a time, and mistakes get introduced at the last step, not the first.",
  },
];

export function Problem() {
  return (
    <section className="border-b border-hairline px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-semibold text-ink sm:text-3xl">The problem</h2>
        <p className="mt-3 max-w-xl text-ink-secondary">
          Assessments run on a cycle. Too much of what happens between cycles is invisible.
        </p>
        <dl className="mt-10 grid gap-8 sm:grid-cols-3">
          {POINTS.map((point) => (
            <div key={point.title} className="border-t border-hairline pt-5">
              <dt className="font-medium text-ink">{point.title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-ink-secondary">{point.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
