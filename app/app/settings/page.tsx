import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createPublicHoliday, removePublicHoliday } from "@/lib/settings/actions";
import { Card } from "@/components/ds/card";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: holidays } = await supabase
    .from("public_holidays")
    .select("id, holiday_date, name")
    .is("deleted_at", null)
    .order("holiday_date");

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">Settings</h1>
        <p className="mt-1 text-sm text-ds-ink-2">Organisation, users, and checklist templates.</p>
      </div>

      <StatusBanner error={error} />

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
