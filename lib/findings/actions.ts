"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { issueClosureRequest } from "@/lib/findings/issue-closure";
import { canReopen, statusAfterReviewDecision, validateReviewDecision } from "@/lib/findings/lifecycle";
import { findingReviewerDecisionSchema, type FindingStatus } from "@/lib/db/findings";

export type FindingActionResult = { ok: true } | { ok: false; message: string };

/**
 * Every write in this file follows the same split as
 * lib/assessment/actions.ts's saveDecision: validate here (for a message
 * a user can read), let 0029_finding_lifecycle.sql's triggers be the
 * actual guarantee. Each write also appends the finding_events row this
 * prompt's "timeline capturing every state change with actor and
 * timestamp" asks for — there is no other writer of that table.
 */

export interface AssignFindingOwnerInput {
  ownerName: string;
  ownerEmail: string;
  ownerOrganisation: string;
  ownerContactId: string | null;
}

export async function assignFindingOwner(findingId: string, input: AssignFindingOwnerInput): Promise<FindingActionResult> {
  if (!input.ownerName.trim() || !input.ownerEmail.trim()) {
    return { ok: false, message: "An owner needs at least a name and an email." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { error } = await supabase
    .from("findings")
    .update({
      owner_name: input.ownerName.trim(),
      owner_email: input.ownerEmail.trim(),
      owner_organisation: input.ownerOrganisation.trim() || null,
      owner_contact_id: input.ownerContactId,
    })
    .eq("id", findingId);
  if (error) return { ok: false, message: error.message };

  await supabase.from("finding_events").insert({
    finding_id: findingId,
    event_type: "owner_assigned",
    actor_id: userData.user.id,
    note: `Owner set to ${input.ownerName.trim()} (${input.ownerEmail.trim()}).`,
  });

  revalidatePath("/app/findings");
  return { ok: true };
}

/** Mirrors lib/rfi/actions.ts's own portalBaseUrl helper. */
async function portalBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}

/**
 * Emails the tokenised closure portal link to the finding's owner (this
 * prompt: "same tokenised pattern as the RFI portal"). Requires
 * owner_contact_id already set — assignFindingOwner's job — since the
 * portal has no session and needs a real entity_contacts row to
 * attribute an upload to.
 */
export async function sendClosureRequest(findingId: string): Promise<FindingActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data: finding, error: readError } = await supabase
    .from("findings")
    .select("owner_contact_id, owner_email, assessment_items!inner(requirement_id, requirements(title), assessments(subject_code))")
    .eq("id", findingId)
    .single();
  if (readError) return { ok: false, message: readError.message };
  if (!finding.owner_contact_id || !finding.owner_email) {
    return { ok: false, message: "Assign an owner (with an email and a known contact) before sending a closure request." };
  }

  const item = (Array.isArray(finding.assessment_items) ? finding.assessment_items[0] : finding.assessment_items) as
    | { requirements: { title: string } | { title: string }[] | null; assessments: { subject_code: string } | { subject_code: string }[] | null }
    | null;
  const requirement = item ? (Array.isArray(item.requirements) ? item.requirements[0] : item.requirements) : null;
  const assessment = item ? (Array.isArray(item.assessments) ? item.assessments[0] : item.assessments) : null;

  try {
    await issueClosureRequest(supabase, {
      findingId,
      ownerEmail: finding.owner_email as string,
      subjectCode: assessment?.subject_code ?? "",
      requirementTitle: requirement?.title ?? "",
      portalBaseUrl: await portalBaseUrl(),
      actorId: userData.user.id,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not send the closure request." };
  }

  revalidatePath("/app/findings");
  return { ok: true };
}

export interface ReviewClosureInput {
  decision: string;
  reason: string | null;
  newDueDate: string | null;
}

/**
 * "Accept closure, or reject with reason and a new due date" (this
 * prompt). Accepting requires closure evidence already on record — the
 * finding cannot be closed without it, checked here and again by
 * 0029_finding_lifecycle.sql's own trigger.
 */
export async function reviewFindingClosure(findingId: string, input: ReviewClosureInput): Promise<FindingActionResult> {
  const decision = findingReviewerDecisionSchema.safeParse(input.decision);
  if (!decision.success) {
    return { ok: false, message: "Choose accept or reject." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data: finding, error: readError } = await supabase.from("findings").select("status").eq("id", findingId).single();
  if (readError) return { ok: false, message: readError.message };

  const { count: evidenceCount, error: evidenceError } = await supabase
    .from("evidence_files")
    .select("id", { count: "exact", head: true })
    .eq("finding_id", findingId);
  if (evidenceError) return { ok: false, message: evidenceError.message };

  const validation = validateReviewDecision({
    status: finding.status as FindingStatus,
    decision: decision.data,
    hasClosureEvidence: (evidenceCount ?? 0) > 0,
    reason: input.reason,
    newDueDate: input.newDueDate,
  });
  if (!validation.ok) return { ok: false, message: validation.message };

  const update: Record<string, unknown> = {
    status: statusAfterReviewDecision(decision.data),
    reviewer_decision: decision.data,
    reviewer_decision_reason: decision.data === "rejected" ? input.reason : null,
    reviewer_decision_at: new Date().toISOString(),
    reviewer_decision_by: userData.user.id,
  };
  if (decision.data === "rejected") {
    update.due_date = input.newDueDate;
  }

  const { error } = await supabase.from("findings").update(update).eq("id", findingId);
  if (error) return { ok: false, message: error.message };

  await supabase.from("finding_events").insert({
    finding_id: findingId,
    event_type: decision.data === "accepted" ? "reviewer_accepted" : "reviewer_rejected",
    actor_id: userData.user.id,
    note: decision.data === "rejected" ? `${input.reason} New due date: ${input.newDueDate}.` : null,
  });

  revalidatePath("/app/findings");
  return { ok: true };
}

/** "A finding cannot be edited after closure; only reopened, which creates a new event" (this prompt). */
export async function reopenFinding(findingId: string): Promise<FindingActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, message: "Sign in required." };

  const { data: finding, error: readError } = await supabase.from("findings").select("status").eq("id", findingId).single();
  if (readError) return { ok: false, message: readError.message };
  if (!canReopen(finding.status as FindingStatus)) {
    return { ok: false, message: "Only a closed finding can be reopened." };
  }

  const { error } = await supabase.from("findings").update({ status: "open" }).eq("id", findingId);
  if (error) return { ok: false, message: error.message };

  await supabase.from("finding_events").insert({ finding_id: findingId, event_type: "reopened", actor_id: userData.user.id });

  revalidatePath("/app/findings");
  return { ok: true };
}
