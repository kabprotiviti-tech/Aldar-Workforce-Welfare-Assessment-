"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Admin-only at the RLS layer (public_holidays_write_admin, 0013_public_holidays.sql). */
export async function createPublicHoliday(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("public_holidays").insert({
    holiday_date: String(formData.get("holiday_date") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
  });
  if (error) {
    redirect(`/app/settings?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/settings");
  redirect("/app/settings");
}

/** Admin-only at the RLS layer (rfi_document_templates_write_admin, 0014_rfi.sql). */
export async function createRfiDocumentTemplate(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const requirementIds = formData.getAll("requirement_ids").map(String).filter(Boolean);
  if (requirementIds.length === 0) {
    redirect(`/app/settings/rfi-templates?error=${encodeURIComponent("Choose at least one requirement this document evidences.")}`);
  }

  const { data: template, error } = await supabase
    .from("rfi_document_templates")
    .insert({
      module: String(formData.get("module") ?? ""),
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    redirect(`/app/settings/rfi-templates?error=${encodeURIComponent(error.message)}`);
  }

  const { error: linkError } = await supabase
    .from("rfi_document_template_requirements")
    .insert(requirementIds.map((requirementId) => ({ document_template_id: template.id, requirement_id: requirementId })));
  if (linkError) {
    redirect(`/app/settings/rfi-templates?error=${encodeURIComponent(linkError.message)}`);
  }

  revalidatePath("/app/settings/rfi-templates");
  redirect("/app/settings/rfi-templates");
}

export async function removePublicHoliday(holidayId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("public_holidays")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", holidayId);
  if (error) {
    redirect(`/app/settings?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/settings");
  redirect("/app/settings");
}
