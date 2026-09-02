"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { coerceEditedValue } from "@/lib/facts/ledger";
import { supabaseFactLedgerDb } from "@/lib/facts/ledger-supabase";
import { bulkAcceptHighConfidence, resolveFact } from "@/lib/facts/resolve";

/**
 * The assessor's three actions on a fact, plus the restricted bulk
 * accept (this prompt). Authorization is the database's:
 * resolve_extracted_fact checks is_staff() itself
 * (0021_fact_ledger.sql), and these run it through the caller's own
 * session-scoped client so auth.uid() — recorded as the audit actor and
 * as resolved_by — is the real assessor rather than a service role.
 */

export type FactActionResult = { ok: true } | { ok: false; message: string };

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/only staff may resolve/i.test(message)) {
    return "You don't have permission to resolve facts.";
  }
  return message;
}

export async function acceptFact(factId: string, assessmentId: string): Promise<FactActionResult> {
  const supabase = await createSupabaseServerClient();
  try {
    const result = await resolveFact(supabaseFactLedgerDb(supabase), factId, { kind: "accept" });
    if (!result.ok) return result;
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

/**
 * `rawValue` arrives as text from an input box; it is coerced to the
 * proposed value's own type (lib/facts/ledger.ts's coerceEditedValue) so
 * an edited number stays a number for whatever consumes it later.
 */
export async function editFact(factId: string, assessmentId: string, rawValue: string): Promise<FactActionResult> {
  const supabase = await createSupabaseServerClient();
  const db = supabaseFactLedgerDb(supabase);

  try {
    const [fact] = await db.getFacts([factId]);
    if (!fact) return { ok: false, message: "That fact no longer exists." };

    const coerced = coerceEditedValue(rawValue, fact.proposedValue);
    if (!coerced.ok) return { ok: false, message: coerced.message };

    const result = await resolveFact(db, factId, { kind: "edit", value: coerced.value });
    if (!result.ok) return result;
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

export async function rejectFact(factId: string, assessmentId: string, reason: string): Promise<FactActionResult> {
  const supabase = await createSupabaseServerClient();
  try {
    const result = await resolveFact(supabaseFactLedgerDb(supabase), factId, { kind: "reject", reason });
    if (!result.ok) return result;
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
  revalidatePath(`/app/assessments/${assessmentId}/evidence`);
  return { ok: true };
}

export type BulkAcceptActionResult = { ok: true; accepted: number; skipped: number } | { ok: false; message: string };

/**
 * Bulk accept. The high-confidence rule is re-applied server-side to the
 * ids the request actually carried (lib/facts/resolve.ts), and each
 * accepted fact is resolved individually so the audit trail still has
 * one row per fact.
 */
export async function bulkAcceptFacts(factIds: string[], assessmentId: string): Promise<BulkAcceptActionResult> {
  if (factIds.length === 0) {
    return { ok: false, message: "No facts to accept." };
  }

  const supabase = await createSupabaseServerClient();
  try {
    const result = await bulkAcceptHighConfidence(supabaseFactLedgerDb(supabase), factIds);
    revalidatePath(`/app/assessments/${assessmentId}/evidence`);
    return { ok: true, accepted: result.accepted, skipped: result.skipped.length };
  } catch (err) {
    return { ok: false, message: friendlyError(err) };
  }
}
