const RULES = [
  {
    statement: "The model reads. It never decides.",
    body: "It extracts values from documents and returns them as structured data. It does not perform arithmetic, compare dates, or judge a threshold. That runs once, in code, the same way every time.",
  },
  {
    statement: "A person sets every compliance status.",
    body: "Compliant, partial, not compliant, not applicable — always chosen by an assessor, always attributed to them, always timestamped.",
  },
  {
    statement: "Nothing reaches a report unconfirmed.",
    body: "Every extracted value passes through an accept, edit, or reject action before it can appear anywhere a client will read it.",
  },
  {
    statement: "The record doesn't forget.",
    body: "The audit log is append-only. No role can edit or delete an entry, ours included.",
  },
];

export function Boundary() {
  return (
    <section className="border-b border-hairline bg-surface px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-semibold text-ink sm:text-3xl">The boundary</h2>
        <p className="mt-3 max-w-xl text-ink-secondary">
          Four sentences decide what the product is allowed to do. Nothing about it changes.
        </p>
        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {RULES.map((rule) => (
            <div key={rule.statement} className="border-t border-hairline pt-5">
              <p className="text-lg font-medium text-ink">{rule.statement}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{rule.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
