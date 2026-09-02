import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generatePortalToken, hashPortalToken, portalTokenExpiry, PORTAL_TOKEN_TTL_DAYS } from "@/lib/rfi/token";
import { sendEmail } from "@/lib/email/send";
import type { DbModule } from "@/lib/db/common";

export interface IssueRfiInput {
  assessmentId: string;
  module: DbModule;
  contactId: string;
  contactEmail: string;
  subjectCode: string;
  /** ISO date (YYYY-MM-DD). Omit to use the database default (14 calendar days from today). */
  dueDate?: string;
  /** e.g. "https://app.example.com" — used to build the emailed portal link. */
  portalBaseUrl: string;
}

export interface IssueRfiResult {
  rfiRequestId: string;
  portalUrl: string;
  checklistItemCount: number;
  dueDate: string;
}

/**
 * Issues an RFI for an assessment (this prompt): builds the document
 * checklist from every active rfi_document_template for the assessment's
 * module, one checklist line per (template, requirement it evidences)
 * pair, sets the due date (defaulting to +14 days), generates the portal
 * token, and emails the entity contact.
 *
 * Split across two clients on purpose: rfi_requests/rfi_checklist_items
 * are written through the caller's own (RLS-scoped, staff) session — the
 * normal can_write_operational() policy governs who may issue an RFI —
 * while rfi_tokens has no RLS policies at all by design (0014_rfi.sql) and
 * is written through the service-role client, the same way
 * extractions/ai_observations are in 0005_evidence_ai.sql.
 */
export async function issueRfi(supabase: SupabaseClient, input: IssueRfiInput): Promise<IssueRfiResult> {
  const { data: templates, error: templatesError } = await supabase
    .from("rfi_document_templates")
    .select("id, name, rfi_document_template_requirements(requirement_id)")
    .eq("module", input.module)
    .is("deleted_at", null);
  if (templatesError) throw templatesError;

  const lines: { document_template_id: string; requirement_id: string; name: string }[] = [];
  for (const template of templates ?? []) {
    const links = (template.rfi_document_template_requirements ?? []) as { requirement_id: string }[];
    for (const link of links) {
      lines.push({ document_template_id: template.id as string, requirement_id: link.requirement_id, name: template.name as string });
    }
  }
  if (lines.length === 0) {
    throw new Error(`No RFI document templates are mapped to requirements for module "${input.module}" yet.`);
  }

  const requestInsert: Record<string, unknown> = { assessment_id: input.assessmentId, contact_id: input.contactId };
  if (input.dueDate) {
    requestInsert.due_date = input.dueDate;
  }

  const { data: request, error: requestError } = await supabase
    .from("rfi_requests")
    .insert(requestInsert)
    .select("id, due_date")
    .single();
  if (requestError) throw requestError;

  const { error: itemsError } = await supabase
    .from("rfi_checklist_items")
    .insert(lines.map((line) => ({ rfi_request_id: request.id, ...line })));
  if (itemsError) throw itemsError;

  const token = generatePortalToken();
  const admin = createSupabaseAdminClient();
  const { error: tokenError } = await admin.from("rfi_tokens").insert({
    rfi_request_id: request.id,
    token_hash: hashPortalToken(token),
    expires_at: portalTokenExpiry(new Date()).toISOString(),
  });
  if (tokenError) throw tokenError;

  const portalUrl = `${input.portalBaseUrl}/rfi/${token}`;

  await sendEmail({
    to: input.contactEmail,
    subject: `Document request — ${input.subjectCode}`,
    text: `Please provide the requested documents for ${input.subjectCode} by ${request.due_date as string}.\n\nUpload here: ${portalUrl}\n\nThis link expires in ${PORTAL_TOKEN_TTL_DAYS} days.`,
  });

  return {
    rfiRequestId: request.id as string,
    portalUrl,
    checklistItemCount: lines.length,
    dueDate: request.due_date as string,
  };
}
