import { EmptyState } from "@/components/ds/empty-state";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Settings</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Organisation, users, and checklist templates.</p>
      <div className="mt-6">
        <EmptyState title="Nothing to configure yet" description="Organisation and user management will live here." />
      </div>
    </div>
  );
}
