const STAGES = [
  { title: "Plan", body: "Set the cycle: which entities, which module, which cadence." },
  { title: "Request", body: "Evidence requests go out with a deadline and a named owner." },
  { title: "Collect", body: "Documents land in one place instead of six inboxes." },
  {
    title: "Review",
    body: "Extracted values are checked against the rule before anyone sees a status.",
  },
  {
    title: "Assess",
    body: "The assessor sets every compliance rating and writes the remark.",
  },
  { title: "Report", body: "Output matches the client's existing report format, header to table." },
  { title: "Act", body: "Findings become actions with an owner and a due date." },
  {
    title: "Monitor",
    body: "Closure is checked next cycle, and recurrence is flagged, not lost.",
  },
];

export function HowItWorks() {
  return (
    <section className="border-b border-hairline px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-semibold text-ink sm:text-3xl">How it works</h2>
        <p className="mt-3 max-w-xl text-ink-secondary">
          One cycle, eight stages. The same sequence for every module.
        </p>
        <ol className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {STAGES.map((stage, index) => (
            <li key={stage.title} className="flex gap-4 border-t border-hairline pt-4">
              <span className="w-6 shrink-0 text-sm text-ink-secondary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="font-medium text-ink">{stage.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{stage.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
