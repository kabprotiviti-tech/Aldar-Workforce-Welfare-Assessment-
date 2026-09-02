import { EmptyState } from "@/components/ds/empty-state";

export default function AccommodationPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Accommodation</h1>
      <p className="mt-1 text-sm text-ds-ink-2">95 facilities per cycle, physical inspection, 12 assessment areas.</p>
      <div className="mt-6">
        <EmptyState
          title="No inspections open yet"
          description="Facility inspections for this programme will appear here once a cycle is planned."
        />
      </div>
    </div>
  );
}
