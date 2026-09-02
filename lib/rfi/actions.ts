"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { issueRfi } from "@/lib/rfi/issue";

async function portalBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}

export async function issueRfiAction(assessmentId: string, formData: FormData): Promise<void> {
  const contactId = String(formData.get("contact_id") ?? "");
  if (!contactId) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent("Choose a contact to send the RFI to.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: assessment, error: assessmentError } = await supabase
    .from("assessments")
    .select("module, subject_code")
    .eq("id", assessmentId)
    .single();
  if (assessmentError) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent(assessmentError.message)}`);
  }

  const { data: contact, error: contactError } = await supabase
    .from("entity_contacts")
    .select("email")
    .eq("id", contactId)
    .single();
  if (contactError || !contact.email) {
    redirect(`/app/assessments/${assessmentId}?error=${encodeURIComponent("That contact has no email address on file.")}`);
  }

  let outcome: { kind: "success"; message: string } | { kind: "error"; message: string };
  try {
    const result = await issueRfi(supabase, {
      assessmentId,
      module: assessment.module,
      contactId,
      contactEmail: contact.email as string,
      subjectCode: assessment.subject_code,
      portalBaseUrl: await portalBaseUrl(),
    });
    outcome = {
      kind: "success",
      message: `RFI issued — ${result.checklistItemCount} document${result.checklistItemCount === 1 ? "" : "s"} requested, due ${result.dueDate}.`,
    };
  } catch (error) {
    outcome = { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }

  if (outcome.kind === "success") {
    revalidatePath(`/app/assessments/${assessmentId}`);
    revalidatePath("/app/evidence");
  }
  redirect(`/app/assessments/${assessmentId}?${outcome.kind}=${encodeURIComponent(outcome.message)}`);
}
