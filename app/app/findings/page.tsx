import { EmptyState } from "@/components/ds/empty-state";

export default function FindingsPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Findings &amp; Actions</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Open findings, their owners, and closure evidence.</p>
      <div className="mt-6">
        <EmptyState title="No open findings" description="Findings raised during an assessment will appear here." />
      </div>
    </div>
  );
}
