import { importEntitiesCsv } from "@/lib/entities/actions";
import { Button } from "@/components/ds/button";
import { Card } from "@/components/ds/card";
import { StatusBanner } from "@/components/app/status-banner";

export default async function ImportEntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold text-ds-ink">Import entity list</h1>
      <p className="mt-1 text-sm text-ds-ink-2">
        The client&apos;s annual entity list, plus contact details, as a CSV file.
      </p>

      <Card className="mt-6">
        <p className="text-sm font-medium text-ds-ink">Expected columns</p>
        <p className="mt-1.5 text-sm text-ds-ink-2">
          Required: <code>entity_code</code>, <code>entity_name</code>, <code>type</code> (
          <code>general_contractor</code>, <code>facilities_management</code>, <code>asset_operator</code>, or{" "}
          <code>subcontractor</code>). Optional: <code>worker_count</code>, <code>project_name</code>,{" "}
          <code>project_type</code>, <code>status</code> (<code>active</code> or <code>inactive</code>),{" "}
          <code>contact_name</code>, <code>contact_role</code>, <code>contact_email</code>,{" "}
          <code>contact_phone</code>, <code>contact_is_primary</code>. Repeat a row with the same{" "}
          <code>entity_code</code> to add a second contact.
        </p>
      </Card>

      <form action={importEntitiesCsv} className="mt-6 grid gap-4">
        <StatusBanner error={error} success={success} />
        <div>
          <label className="block text-sm font-medium text-ds-ink" htmlFor="file">
            CSV file
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="ds-focus-ring mt-1.5 block w-full text-sm text-ds-ink"
          />
        </div>
        <p className="text-xs text-ds-ink-2">
          If any row fails validation, nothing is imported — fix the file and try again.
        </p>
        <Button type="submit" className="justify-self-start">
          Import
        </Button>
      </form>
    </div>
  );
}
