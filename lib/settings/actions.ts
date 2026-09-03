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

/**
 * Revising the compliance scoring weights (this prompt: "configurable...
 * selectable in Settings"). Same "an edit is a new version, never an
 * update" shape as lib/rules/compliance/actions.ts's reviseRuleThresholds:
 * a report already generated under version n must keep meaning what it
 * meant, so an edit deactivates the current row and inserts a fresh one
 * rather than mutating it — the database enforces this too
 * (0032_scoring_weights.sql's scoring_weights_immutable_once_used).
 * Admin-only at the RLS layer (scoring_weights_write_admin).
 */
export async function reviseScoringWeights(formData: FormData): Promise<void> {
  const compliant = Number(formData.get("compliant_weight"));
  const partial = Number(formData.get("partial_weight"));
  const notCompliant = Number(formData.get("not_compliant_weight"));

  if (![compliant, partial, notCompliant].every(Number.isFinite)) {
    redirect(`/app/settings?error=${encodeURIComponent("Weights must be numbers.")}`);
  }

  const supabase = await createSupabaseServerClient();

  const { data: current, error: readError } = await supabase
    .from("scoring_weights")
    .select("id, version")
    .eq("active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) redirect(`/app/settings?error=${encodeURIComponent(readError.message)}`);
  if (!current) redirect(`/app/settings?error=${encodeURIComponent("No active scoring weights found.")}`);

  const { error: deactivateError } = await supabase.from("scoring_weights").update({ active: false }).eq("id", current.id);
  if (deactivateError) redirect(`/app/settings?error=${encodeURIComponent(deactivateError.message)}`);

  const { error: insertError } = await supabase.from("scoring_weights").insert({
    version: (current.version as number) + 1,
    compliant_weight: compliant,
    partial_weight: partial,
    not_compliant_weight: notCompliant,
  });
  if (insertError) redirect(`/app/settings?error=${encodeURIComponent(insertError.message)}`);

  revalidatePath("/app/settings");
  redirect("/app/settings");
}
