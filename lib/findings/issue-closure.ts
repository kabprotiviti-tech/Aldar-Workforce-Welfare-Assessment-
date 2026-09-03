import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generatePortalToken, hashPortalToken } from "@/lib/rfi/token";
import { closureTokenExpiry, CLOSURE_TOKEN_TTL_DAYS } from "@/lib/findings/closure-portal";
import { statusAfterWorkStarted } from "@/lib/findings/lifecycle";
import { sendEmail } from "@/lib/email/send";

export interface IssueClosureRequestInput {
  findingId: string;
  ownerEmail: string;
  subjectCode: string;
  requirementTitle: string;
  /** e.g. "https://app.example.com" — used to build the emailed portal link. */
  portalBaseUrl: string;
  actorId: string;
}

export interface IssueClosureRequestResult {
  portalUrl: string;
}

/**
 * Issues the closure portal link for a finding (this prompt: "same
 * tokenised pattern as the RFI portal"). Split across two clients on
 * purpose — the same reasoning as lib/rfi/issue.ts: the finding's own
 * status write goes through the caller's session (normal
 * can_write_operational() policy governs who may send a closure
 * request), while finding_closure_tokens has no RLS policies at all and
 * is written through the service-role client.
 *
 * Requires an owner_contact_id already set on the finding — the portal
 * has no Supabase session, so an uploaded file's uploaded_by_contact_id
 * has to come from a real entity_contacts row, not free text. Assigning
 * one is a separate step (lib/findings/actions.ts's assignFindingOwner).
 */
export async function issueClosureRequest(supabase: SupabaseClient, input: IssueClosureRequestInput): Promise<IssueClosureRequestResult> {
  const { data: current, error: readError } = await supabase.from("findings").select("status").eq("id", input.findingId).single();
  if (readError) throw readError;
  if (current.status === "closed") {
    throw new Error("This finding is already closed — reopen it before requesting closure again.");
  }

  const nextStatus = statusAfterWorkStarted(current.status as Parameters<typeof statusAfterWorkStarted>[0]);
  if (nextStatus !== current.status) {
    const { error: statusError } = await supabase.from("findings").update({ status: nextStatus }).eq("id", input.findingId);
    if (statusError) throw statusError;
  }

  const token = generatePortalToken();
  const admin = createSupabaseAdminClient();
  const { error: tokenError } = await admin.from("finding_closure_tokens").insert({
    finding_id: input.findingId,
    token_hash: hashPortalToken(token),
    expires_at: closureTokenExpiry(new Date()).toISOString(),
  });
  if (tokenError) throw tokenError;

  const portalUrl = `${input.portalBaseUrl}/findings/${token}`;

  await sendEmail({
    to: input.ownerEmail,
    subject: `Closure requested — ${input.subjectCode}`,
    text: `A finding raised against "${input.requirementTitle}" for ${input.subjectCode} needs closure evidence.\n\nSubmit it here: ${portalUrl}\n\nThis link expires in ${CLOSURE_TOKEN_TTL_DAYS} days.`,
  });

  await supabase.from("finding_events").insert({
    finding_id: input.findingId,
    event_type: "started",
    actor_id: input.actorId,
    note: `Closure request sent to ${input.ownerEmail}.`,
  });

  return { portalUrl };
}
