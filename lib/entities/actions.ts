"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseEntityCsv } from "@/lib/scheduling/csv-import";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function optStr(formData: FormData, key: string): string | null {
  const value = str(formData, key);
  return value === "" ? null : value;
}

function optInt(formData: FormData, key: string): number | null {
  const value = str(formData, key);
  if (value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function createEntity(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("entities").insert({
    name: str(formData, "name"),
    entity_code: str(formData, "entity_code"),
    type: str(formData, "type"),
    worker_count: optInt(formData, "worker_count"),
    project_name: optStr(formData, "project_name"),
    project_type: optStr(formData, "project_type"),
  });
  if (error) {
    redirect(`/app/entities/new?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/entities");
  redirect("/app/entities");
}

export async function updateEntity(entityId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("entities")
    .update({
      name: str(formData, "name"),
      entity_code: str(formData, "entity_code"),
      type: str(formData, "type"),
      worker_count: optInt(formData, "worker_count"),
      project_name: optStr(formData, "project_name"),
      project_type: optStr(formData, "project_type"),
      status: str(formData, "status"),
      nda_required: formData.get("nda_required") === "on",
    })
    .eq("id", entityId);
  if (error) {
    redirect(`/app/entities/${entityId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/entities/${entityId}`);
  revalidatePath("/app/entities");
  redirect(`/app/entities/${entityId}?success=${encodeURIComponent("Entity updated.")}`);
}

/**
 * NDA gate (this prompt): one confirmation unlocks this entity's evidence
 * for every staff member, not per-viewer — see docs/decisions.md.
 */
export async function confirmNda(entityId: string, returnTo: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("entities")
    .update({ nda_confirmed_at: new Date().toISOString(), nda_confirmed_by: userData.user?.id })
    .eq("id", entityId);
  if (error) {
    redirect(`${returnTo}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(returnTo);
  redirect(returnTo);
}

export async function createContact(entityId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("entity_contacts").insert({
    entity_id: entityId,
    name: str(formData, "name"),
    role: optStr(formData, "role"),
    email: optStr(formData, "email"),
    phone: optStr(formData, "phone"),
    is_primary: formData.get("is_primary") === "on",
  });
  if (error) {
    redirect(`/app/entities/${entityId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/entities/${entityId}`);
  redirect(`/app/entities/${entityId}`);
}

export async function updateContact(contactId: string, entityId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("entity_contacts")
    .update({
      name: str(formData, "name"),
      role: optStr(formData, "role"),
      email: optStr(formData, "email"),
      phone: optStr(formData, "phone"),
      is_primary: formData.get("is_primary") === "on",
    })
    .eq("id", contactId);
  if (error) {
    redirect(`/app/entities/${entityId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/entities/${entityId}`);
  redirect(`/app/entities/${entityId}`);
}

/** Soft delete only (deleted_at), per CONTEXT.md's "never hard delete" convention. */
export async function removeContact(contactId: string, entityId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("entity_contacts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", contactId);
  if (error) {
    redirect(`/app/entities/${entityId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/entities/${entityId}`);
  redirect(`/app/entities/${entityId}`);
}

export async function createFacility(entityId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("facilities").insert({
    entity_id: entityId,
    name: str(formData, "name"),
    facility_code: str(formData, "facility_code"),
    emirate: optStr(formData, "emirate"),
    area: optStr(formData, "area"),
    capacity: optInt(formData, "capacity"),
    regulatory_body: optStr(formData, "regulatory_body"),
    access_permission_required: formData.get("access_permission_required") === "on",
  });
  if (error) {
    redirect(`/app/entities/${entityId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/entities/${entityId}`);
  redirect(`/app/entities/${entityId}`);
}

export async function updateFacility(facilityId: string, entityId: string, formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("facilities")
    .update({
      name: str(formData, "name"),
      facility_code: str(formData, "facility_code"),
      emirate: optStr(formData, "emirate"),
      area: optStr(formData, "area"),
      capacity: optInt(formData, "capacity"),
      regulatory_body: optStr(formData, "regulatory_body"),
      access_permission_required: formData.get("access_permission_required") === "on",
    })
    .eq("id", facilityId);
  if (error) {
    redirect(`/app/entities/${entityId}/facilities/${facilityId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/entities/${entityId}`);
  revalidatePath(`/app/entities/${entityId}/facilities/${facilityId}`);
  redirect(`/app/entities/${entityId}/facilities/${facilityId}?success=${encodeURIComponent("Facility updated.")}`);
}

/**
 * CSV import for the client's annual entity list (this prompt). Fails
 * closed: any validation error stops the whole import before writing
 * anything (lib/scheduling/csv-import.ts). Contacts are matched to an
 * existing row by (entity, lower(email) if given else lower(name)) and
 * updated in place; anything unmatched is inserted as new. This is a
 * best-effort, non-transactional import (see docs/decisions.md) — fine
 * for an infrequent, human-supervised annual upload, not a hot path.
 */
export async function importEntitiesCsv(formData: FormData): Promise<void> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/app/entities/import?error=${encodeURIComponent("Choose a CSV file to import.")}`);
  }

  const text = await (file as File).text();
  const { entities, errors } = parseEntityCsv(text);
  if (errors.length > 0) {
    const summary = errors
      .slice(0, 10)
      .map((e) => `Row ${e.row}: ${e.message}`)
      .join(" | ");
    const suffix = errors.length > 10 ? ` (+${errors.length - 10} more)` : "";
    redirect(`/app/entities/import?error=${encodeURIComponent(`${errors.length} error(s) — nothing was imported. ${summary}${suffix}`)}`);
  }
  if (entities.length === 0) {
    redirect(`/app/entities/import?error=${encodeURIComponent("No entity rows found in the file.")}`);
  }

  const supabase = await createSupabaseServerClient();

  const { data: upserted, error: upsertError } = await supabase
    .from("entities")
    .upsert(
      entities.map((e) => ({
        name: e.name,
        entity_code: e.entityCode,
        type: e.type,
        worker_count: e.workerCount,
        project_name: e.projectName,
        project_type: e.projectType,
        status: e.status,
      })),
      { onConflict: "entity_code" },
    )
    .select("id, entity_code");
  if (upsertError) {
    redirect(`/app/entities/import?error=${encodeURIComponent(upsertError.message)}`);
  }

  const idByCode = new Map((upserted ?? []).map((row) => [row.entity_code as string, row.id as string]));
  const entityIds = Array.from(idByCode.values());

  const { data: existingContacts, error: contactsError } = await supabase
    .from("entity_contacts")
    .select("id, entity_id, name, email")
    .in("entity_id", entityIds)
    .is("deleted_at", null);
  if (contactsError) {
    redirect(`/app/entities/import?error=${encodeURIComponent(contactsError.message)}`);
  }

  const existingByKey = new Map(
    (existingContacts ?? []).map((c) => [
      `${c.entity_id}:${((c.email as string | null) ?? (c.name as string)).toLowerCase()}`,
      c.id as string,
    ]),
  );

  const toInsert: Record<string, unknown>[] = [];
  const updates: { id: string; fields: Record<string, unknown> }[] = [];
  let contactCount = 0;
  for (const entity of entities) {
    const entityId = idByCode.get(entity.entityCode);
    if (!entityId) continue;
    for (const contact of entity.contacts) {
      contactCount += 1;
      const fields = {
        entity_id: entityId,
        name: contact.name,
        role: contact.role,
        email: contact.email,
        phone: contact.phone,
        is_primary: contact.isPrimary,
      };
      const key = `${entityId}:${(contact.email ?? contact.name).toLowerCase()}`;
      const existingId = existingByKey.get(key);
      if (existingId) {
        updates.push({ id: existingId, fields });
      } else {
        toInsert.push(fields);
      }
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("entity_contacts").insert(toInsert);
    if (error) {
      redirect(`/app/entities/import?error=${encodeURIComponent(error.message)}`);
    }
  }
  for (const update of updates) {
    const { error } = await supabase.from("entity_contacts").update(update.fields).eq("id", update.id);
    if (error) {
      redirect(`/app/entities/import?error=${encodeURIComponent(error.message)}`);
    }
  }

  revalidatePath("/app/entities");
  redirect(
    `/app/entities/import?success=${encodeURIComponent(
      `Imported ${entities.length} entit${entities.length === 1 ? "y" : "ies"} and ${contactCount} contact${contactCount === 1 ? "" : "s"}.`,
    )}`,
  );
}
