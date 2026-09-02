import { EmptyState } from "@/components/ds/empty-state";

export default function EmploymentPracticesPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Employment Practices</h1>
      <p className="mt-1 text-sm text-ds-ink-2">73 entities per cycle, office visit, 23 requirements.</p>
      <div className="mt-6">
        <EmptyState
          title="No assessments open yet"
          description="Assessments for this programme will appear here once a cycle is planned."
        />
      </div>
    </div>
  );
}
