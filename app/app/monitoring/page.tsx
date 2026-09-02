import { EmptyState } from "@/components/ds/empty-state";

export default function MonitoringPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Monitoring</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Closure checks and recurrence across cycles.</p>
      <div className="mt-6">
        <EmptyState
          title="Nothing to monitor yet"
          description="Once a cycle closes, its findings' closure status carries forward here."
        />
      </div>
    </div>
  );
}
