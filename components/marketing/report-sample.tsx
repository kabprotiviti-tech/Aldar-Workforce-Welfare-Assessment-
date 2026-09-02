const HEADER_FIELDS: Array<[string, string]> = [
  ["Subject", "2024-EP-FU-SMPL-2.1"],
  ["Originator", "WWAP"],
  ["Date", "14 Mar 2024"],
  ["Description", "Employment practices follow-up"],
  ["Type", "Follow-up"],
  ["Project Type", "Construction"],
  ["Project Name", "Sample development"],
  ["Associated entity", "Sample contractor LLC"],
  ["Audit number", "3"],
  ["Latest", "Yes"],
  ["Reassessed", "No"],
  ["Accommodation name", "N/A"],
];

const SUMMARY: Array<[string, string, boolean]> = [
  ["Risk", "Medium", false],
  ["Overall compliance", "87%", true],
  ["Adjusted for not assessed", "91%", true],
];

const ROWS = [
  {
    requirement: "Requirement 8: Wages paid on time and in full",
    remarks: "Payroll records for Feb 2024 show a 6-day delay against the contract due date.",
    action: "Contractor to issue revised payroll SOP by 30 Apr 2024.",
    status: "Partial",
  },
  {
    requirement: "Requirement 16: Grievance mechanism accessible to all workers",
    remarks: "Grievance log and worker interviews consistent with policy.",
    action: "N/A",
    status: "Compliant",
  },
  {
    requirement: "Requirement 19: No unauthorised recruitment fees charged",
    remarks: "This section was not assessed as part of this review. Previous monitoring has identified the policies, procedures and their application relating to this section as compliant with Aldar's Worker Welfare Policy.",
    action: "N/A",
    status: "Compliant",
  },
] as const;

const STATUS_COLOR: Record<string, string> = {
  Compliant: "text-compliant",
  Partial: "text-partial",
  "Not Compliant": "text-not-compliant",
  "Not Applicable": "text-not-applicable",
};

export function ReportSample() {
  return (
    <section id="report" className="border-b border-hairline px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-semibold text-ink sm:text-3xl">The report</h2>
        <p className="mt-3 max-w-xl text-ink-secondary">
          Output matches the client&apos;s existing report format exactly — same header block,
          same table columns, same carry-forward wording. Sample data below.
        </p>

        <div className="mt-10 border border-hairline">
          <dl className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-3">
            {HEADER_FIELDS.map(([label, value]) => (
              <div key={label} className="bg-surface px-4 py-3">
                <dt className="text-xs text-ink-secondary">{label}</dt>
                <dd className="mt-1 text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-3 gap-px border-t border-hairline bg-hairline">
            {SUMMARY.map(([label, value, isNumeral]) => (
              <div key={label} className="bg-surface px-4 py-3">
                <dt className="text-xs text-ink-secondary">{label}</dt>
                <dd
                  className={
                    isNumeral ? "numeral-display mt-1 text-xl text-ink" : "mt-1 text-lg font-medium text-ink"
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-ink-secondary">
                  <th className="px-4 py-3 font-medium">Worker welfare requirement</th>
                  <th className="px-4 py-3 font-medium">Remarks</th>
                  <th className="px-4 py-3 font-medium">Actions required for closure</th>
                  <th className="px-4 py-3 font-medium">Compliance assessment</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.requirement} className="border-b border-hairline last:border-b-0">
                    <td className="px-4 py-3 align-top text-ink">{row.requirement}</td>
                    <td className="px-4 py-3 align-top text-ink-secondary">{row.remarks}</td>
                    <td className="px-4 py-3 align-top text-ink-secondary">{row.action}</td>
                    <td className={`px-4 py-3 align-top font-medium ${STATUS_COLOR[row.status] ?? "text-ink"}`}>
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-secondary">Illustrative sample data, not a real assessment.</p>
      </div>
    </section>
  );
}
