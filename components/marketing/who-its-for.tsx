const AUDIENCE = [
  {
    role: "Assessors",
    body: "Run the office visit or site inspection, confirm every extracted value, and write the remark the client will read.",
  },
  {
    role: "QA reviewers",
    body: "Check an assessor's work before it ships — every status change is attributed, so a second read is fast, not forensic.",
  },
  {
    role: "Admins",
    body: "Set up the cycle, the entities, and the requirement set, and see where a cycle is running behind before it's due.",
  },
  {
    role: "Client viewers",
    body: "See approved reports and open findings for their own entities — nothing in draft, nothing outside their scope.",
  },
];

export function WhoItsFor() {
  return (
    <section className="border-b border-hairline px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-semibold text-ink sm:text-3xl">Who it&apos;s for</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {AUDIENCE.map((entry) => (
            <div key={entry.role} className="border-t border-hairline pt-5">
              <p className="font-medium text-ink">{entry.role}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{entry.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
