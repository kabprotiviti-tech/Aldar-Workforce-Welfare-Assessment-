import { EmptyState } from "@/components/ds/empty-state";

export default function OnboardingPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Onboarding</h1>
      <p className="mt-1 text-sm text-ds-ink-2">
        17 entities per cycle: desktop document review, then office visit, then a final compliance report.
      </p>
      <div className="mt-6">
        <EmptyState
          title="No assessments open yet"
          description="Assessments for this programme will appear here once a cycle is planned."
        />
      </div>
    </div>
  );
}
