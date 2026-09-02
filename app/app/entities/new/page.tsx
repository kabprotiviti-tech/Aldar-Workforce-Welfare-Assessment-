import { createEntity } from "@/lib/entities/actions";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { StatusBanner } from "@/components/app/status-banner";

const ENTITY_TYPES = [
  ["general_contractor", "General contractor"],
  ["facilities_management", "Facilities management"],
  ["asset_operator", "Asset operator"],
  ["subcontractor", "Subcontractor"],
] as const;

export default async function NewEntityPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-semibold text-ds-ink">New entity</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Add a supply-chain company to be assessed.</p>

      <form action={createEntity} className="mt-6 grid gap-4">
        <StatusBanner error={error} />
        <Field label="Name" name="name" required />
        <Field label="Entity code" name="entity_code" required helperText="Used in report subject codes." />
        <div>
          <label className="block text-sm font-medium text-ds-ink" htmlFor="type">
            Type
          </label>
          <select
            id="type"
            name="type"
            required
            className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
          >
            {ENTITY_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <Field label="Worker count" name="worker_count" type="number" min={0} />
        <Field label="Project name" name="project_name" />
        <Field label="Project type" name="project_type" />
        <Button type="submit" className="justify-self-start">
          Create entity
        </Button>
      </form>
    </div>
  );
}
