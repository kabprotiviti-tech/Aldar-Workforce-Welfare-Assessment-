import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createContact, createFacility, removeContact, updateEntity } from "@/lib/entities/actions";
import { Field } from "@/components/ds/field";
import { Button } from "@/components/ds/button";
import { Card } from "@/components/ds/card";
import { Pill } from "@/components/ds/pill";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { EmptyState } from "@/components/ds/empty-state";
import { StatusBanner } from "@/components/app/status-banner";

const ENTITY_TYPES = [
  ["general_contractor", "General contractor"],
  ["facilities_management", "Facilities management"],
  ["asset_operator", "Asset operator"],
  ["subcontractor", "Subcontractor"],
] as const;

export default async function EntityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: entity }, { data: contacts }, { data: facilities }] = await Promise.all([
    supabase.from("entities").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("entity_contacts").select("*").eq("entity_id", id).is("deleted_at", null).order("is_primary", { ascending: false }),
    supabase.from("facilities").select("id, name, facility_code, emirate, capacity").eq("entity_id", id).is("deleted_at", null).order("name"),
  ]);

  if (!entity) {
    notFound();
  }

  return (
    <div className="grid gap-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-ds-ink">{entity.name}</h1>
          <Pill tone={entity.status === "active" ? "ok" : "neutral"}>{entity.status}</Pill>
        </div>
        <p className="mt-1 text-sm text-ds-ink-2">{entity.entity_code}</p>
      </div>

      <StatusBanner error={error} success={success} />

      <Card className="max-w-lg">
        <p className="text-sm font-medium text-ds-ink">Details</p>
        <form action={updateEntity.bind(null, entity.id)} className="mt-4 grid gap-4">
          <Field label="Name" name="name" defaultValue={entity.name} required />
          <Field label="Entity code" name="entity_code" defaultValue={entity.entity_code} required />
          <div>
            <label className="block text-sm font-medium text-ds-ink" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              name="type"
              defaultValue={entity.type}
              className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
            >
              {ENTITY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ds-ink" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={entity.status}
              className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <Field label="Worker count" name="worker_count" type="number" min={0} defaultValue={entity.worker_count ?? ""} />
          <Field label="Project name" name="project_name" defaultValue={entity.project_name ?? ""} />
          <Field label="Project type" name="project_type" defaultValue={entity.project_type ?? ""} />
          <label className="flex items-center gap-2 text-sm text-ds-ink">
            <input type="checkbox" name="nda_required" defaultChecked={entity.nda_required} className="ds-focus-ring" />
            NDA required before evidence can be opened
          </label>
          <Button type="submit" className="justify-self-start">
            Save
          </Button>
        </form>
      </Card>

      <div>
        <p className="text-sm font-medium text-ds-ink">Contacts</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {!contacts || contacts.length === 0 ? (
            <EmptyState title="No contacts yet" />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Phone</TableHeaderCell>
                  <TableHeaderCell></TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      {contact.name}
                      {contact.is_primary && (
                        <Pill tone="info" className="ml-2">
                          Primary
                        </Pill>
                      )}
                    </TableCell>
                    <TableCell>{contact.role ?? "—"}</TableCell>
                    <TableCell>{contact.email ?? "—"}</TableCell>
                    <TableCell>{contact.phone ?? "—"}</TableCell>
                    <TableCell>
                      <form action={removeContact.bind(null, contact.id, entity.id)}>
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
            <p className="text-sm font-medium text-ds-ink">Add a contact</p>
            <form action={createContact.bind(null, entity.id)} className="mt-4 grid gap-3">
              <Field label="Name" name="name" required />
              <Field label="Role" name="role" />
              <Field label="Email" name="email" type="email" />
              <Field label="Phone" name="phone" type="tel" />
              <label className="flex items-center gap-2 text-sm text-ds-ink">
                <input type="checkbox" name="is_primary" className="ds-focus-ring" />
                Primary contact
              </label>
              <Button type="submit" variant="secondary" className="justify-self-start">
                Add contact
              </Button>
            </form>
          </Card>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-ds-ink">Facilities</p>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {!facilities || facilities.length === 0 ? (
            <EmptyState title="No facilities yet" description="Facilities are assessed under the Accommodation module." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Emirate</TableHeaderCell>
                  <TableHeaderCell numeric>Capacity</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {facilities.map((facility) => (
                  <TableRow key={facility.id}>
                    <TableCell>
                      <Link
                        href={`/app/entities/${entity.id}/facilities/${facility.id}`}
                        className="ds-focus-ring font-medium text-ds-accent-2 hover:underline"
                      >
                        {facility.name}
                      </Link>
                    </TableCell>
                    <TableCell>{facility.facility_code}</TableCell>
                    <TableCell>{facility.emirate ?? "—"}</TableCell>
                    <TableCell numeric>{facility.capacity ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Card>
            <p className="text-sm font-medium text-ds-ink">Add a facility</p>
            <form action={createFacility.bind(null, entity.id)} className="mt-4 grid gap-3">
              <Field label="Name" name="name" required />
              <Field label="Facility code" name="facility_code" required />
              <Field label="Emirate" name="emirate" />
              <Field label="Area" name="area" />
              <Field label="Capacity" name="capacity" type="number" min={0} />
              <Field label="Regulatory body" name="regulatory_body" helperText="e.g. AD Ports, if permission is required to visit." />
              <label className="flex items-center gap-2 text-sm text-ds-ink">
                <input type="checkbox" name="access_permission_required" className="ds-focus-ring" />
                Requires access permission to visit
              </label>
              <Button type="submit" variant="secondary" className="justify-self-start">
                Add facility
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
