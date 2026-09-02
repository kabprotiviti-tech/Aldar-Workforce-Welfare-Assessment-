import { EmptyState } from "@/components/ds/empty-state";

export default function EvidenceCentrePage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Evidence Centre</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Documents, photos, and what the model extracted from them.</p>
      <div className="mt-6">
        <EmptyState title="No evidence uploaded yet" description="Files uploaded against an assessment will appear here." />
      </div>
    </div>
  );
}
