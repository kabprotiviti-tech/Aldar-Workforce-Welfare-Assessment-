import { EmptyState } from "@/components/ds/empty-state";

export default function ReportsPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Reports</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Generated reports, matched to the client&apos;s existing format.</p>
      <div className="mt-6">
        <EmptyState title="No reports generated yet" description="A generated report will appear here, versioned per assessment." />
      </div>
    </div>
  );
}
