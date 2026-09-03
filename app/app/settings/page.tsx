import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createPublicHoliday, removePublicHoliday, reviseScoringWeights } from "@/lib/settings/actions";
import { Card } from "@/components/ds/card";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [{ data: holidays }, { data: scoringWeights }] = await Promise.all([
    supabase.from("public_holidays").select("id, holiday_date, name").is("deleted_at", null).order("holiday_date"),
    supabase
      .from("scoring_weights")
      .select("version, compliant_weight, partial_weight, not_compliant_weight")
      .eq("active", true)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">Settings</h1>
        <p className="mt-1 text-sm text-ds-ink-2">Organisation, users, and checklist templates.</p>
      </div>

      <StatusBanner error={error} />

      <div>
        <p className="text-sm font-medium text-ds-ink">RFI document templates</p>
        <p className="mt-1 text-sm text-ds-ink-2">
          Requested document types per module, and the requirements each evidences.
        </p>
        <Link
          href="/app/settings/rfi-templates"
          className="ds-focus-ring mt-3 inline-flex items-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface px-3.5 py-2 text-sm font-medium text-ds-ink hover:border-ds-accent"
        >
          Manage RFI templates
        </Link>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">Compliance scoring weights</p>
        <p className="mt-1 text-sm text-ds-ink-2">
          What Compliant/Partial/Not Compliant are worth in the report&apos;s Overall Compliance (%) and Compliance
          adjusted for not assessed (%) — Not Applicable is always excluded from scoring. Editing these creates a new
          version; every report already generated keeps the version it actually used (see docs/decisions.md — the
          client&apos;s exact formula still needs confirming, these are a starting default).
        </p>
        <Card className="mt-4 max-w-lg">
          {scoringWeights ? (
            <form action={reviseScoringWeights} className="grid gap-4">
              <p className="text-xs text-ds-ink-2">Current version: {scoringWeights.version}</p>
              <Field
                label="Compliant weight"
                name="compliant_weight"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={scoringWeights.compliant_weight}
                required
              />
              <Field
                label="Partial weight"
                name="partial_weight"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={scoringWeights.partial_weight}
                required
              />
              <Field
                label="Not Compliant weight"
                name="not_compliant_weight"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={scoringWeights.not_compliant_weight}
                required
              />
              <Button type="submit" variant="secondary" className="justify-self-start">
                Save as new version
              </Button>
            </form>
          ) : (
            <p className="text-sm text-ds-ink-2">No scoring weights configured.</p>
          )}
        </Card>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">UAE public holiday calendar</p>
        <p className="mt-1 text-sm text-ds-ink-2">
          Weekends (Saturday/Sunday) and every date below are excluded from report-due-date arithmetic. Fixed-date
          holidays are seeded; Islamic-calendar holidays (Eid al-Fitr, Eid al-Adha, etc.) are set by moon sighting and
          announced close to the date — add each year&apos;s once the UAE government confirms them.
        </p>

        <div className="mt-4 grid gap-6 lg:grid-cols-[2fr_1fr]">
          {!holidays || holidays.length === 0 ? (
            <EmptyState title="No holidays configured" />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell></TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {holidays.map((holiday) => (
                  <TableRow key={holiday.id}>
                    <TableCell>{holiday.holiday_date}</TableCell>
                    <TableCell>{holiday.name}</TableCell>
                    <TableCell>
                      <form action={removePublicHoliday.bind(null, holiday.id)}>
                        <button type="submit" className="ds-focus-ring text-sm text-ds-bad hover:underline">
                          Remove
                        </button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Card>
            <p className="text-sm font-medium text-ds-ink">Add a holiday</p>
            <form action={createPublicHoliday} className="mt-4 grid gap-3">
              <Field label="Date" name="holiday_date" type="date" required />
              <Field label="Name" name="name" required placeholder="e.g. Eid al-Fitr" />
              <Button type="submit" variant="secondary" className="justify-self-start">
                Add
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
