import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateFacility } from "@/lib/entities/actions";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { Card } from "@/components/ds/card";
import { StatusBanner } from "@/components/app/status-banner";

export default async function FacilityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; facilityId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id, facilityId } = await params;
  const { error, success } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: facility } = await supabase
    .from("facilities")
    .select("*")
    .eq("id", facilityId)
    .eq("entity_id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!facility) {
    notFound();
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-semibold text-ds-ink">{facility.name}</h1>
      <p className="mt-1 text-sm text-ds-ink-2">{facility.facility_code}</p>

      <StatusBanner error={error} success={success} />

      <Card className="mt-6">
        <form action={updateFacility.bind(null, facility.id, id)} className="grid gap-4">
          <Field label="Name" name="name" defaultValue={facility.name} required />
          <Field label="Facility code" name="facility_code" defaultValue={facility.facility_code} required />
          <Field label="Emirate" name="emirate" defaultValue={facility.emirate ?? ""} />
          <Field label="Area" name="area" defaultValue={facility.area ?? ""} />
          <Field label="Capacity" name="capacity" type="number" min={0} defaultValue={facility.capacity ?? ""} />
          <Field
            label="Regulatory body"
            name="regulatory_body"
            defaultValue={facility.regulatory_body ?? ""}
            helperText="e.g. AD Ports, if permission is required to visit."
          />
          <label className="flex items-center gap-2 text-sm text-ds-ink">
            <input
              type="checkbox"
              name="access_permission_required"
              defaultChecked={facility.access_permission_required}
              className="ds-focus-ring"
            />
            Requires access permission to visit
          </label>
          <Button type="submit" className="justify-self-start">
            Save
          </Button>
        </form>
      </Card>
    </div>
  );
}
