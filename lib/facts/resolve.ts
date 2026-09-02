import { isBulkAcceptable, type FactValue, type LedgerFact } from "@/lib/facts/ledger";

/**
 * Resolution orchestration for the fact ledger — accept, edit, reject,
 * and the restricted bulk accept. Pure over an injected port (no
 * "server-only", no Supabase client) so the rules that matter can be
 * proven both without a database (lib/facts/resolve.test.ts) and against
 * a real one (tests/db/fact-ledger.test.ts), the same ports-and-adapters
 * split as lib/ai/extract.ts and lib/rfi/portal.ts.
 */

export type FactResolution =
  | { kind: "accept" }
  | { kind: "edit"; value: FactValue }
  | { kind: "reject"; reason: string };

export interface ResolveFactDbInput {
  factId: string;
  status: "accepted" | "edited" | "rejected";
  /** The human's value, enveloped as {"value": ...}, for an edit only. */
  resolvedValue: { value: FactValue } | null;
  rejectionReason: string | null;
}

/**
 * The ledger's write port. Note there is deliberately no separate
 * "append to audit_log" method: applying a resolution and writing its
 * audit row are one transaction in the database
 * (0021_fact_ledger.sql's resolve_extracted_fact), so no implementation
 * of this interface — and no caller of it — can change a fact's status
 * without also recording who did it. That's this prompt's "every
 * accept/edit/reject writes to audit_log", made structural.
 */
export interface FactLedgerDb {
  getFacts(factIds: string[]): Promise<LedgerFact[]>;
  resolveFact(input: ResolveFactDbInput): Promise<void>;
}

export type ResolveResult = { ok: true } | { ok: false; message: string };

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

export async function resolveFact(db: FactLedgerDb, factId: string, resolution: FactResolution): Promise<ResolveResult> {
  const [fact] = await db.getFacts([factId]);
  if (!fact) {
    return { ok: false, message: "That fact no longer exists." };
  }

  if (resolution.kind === "reject") {
    if (isBlank(resolution.reason)) {
      return { ok: false, message: "Give a reason for rejecting this fact." };
    }
    await db.resolveFact({ factId, status: "rejected", resolvedValue: null, rejectionReason: resolution.reason.trim() });
    return { ok: true };
  }

  if (resolution.kind === "edit") {
    // An assessor who believes there is no value should reject the fact
    // with a reason, not silently blank it — a null "confirmed" value
    // would be consumed downstream as a real, human-confirmed absence.
    if (resolution.value === null || (typeof resolution.value === "string" && isBlank(resolution.value))) {
      return { ok: false, message: "Enter a value, or reject the fact instead." };
    }
    const value = typeof resolution.value === "string" ? resolution.value.trim() : resolution.value;
    await db.resolveFact({ factId, status: "edited", resolvedValue: { value }, rejectionReason: null });
    return { ok: true };
  }

  await db.resolveFact({ factId, status: "accepted", resolvedValue: null, rejectionReason: null });
  return { ok: true };
}

export interface BulkAcceptResult {
  accepted: number;
  /** Ids the request asked for but this refused: not high confidence, already resolved, or gone. */
  skipped: string[];
}

/**
 * Bulk accept, restricted to high confidence (this prompt). Two
 * properties this exists to guarantee:
 *
 * 1. The confidence rule is applied to the ids the *request* carried,
 *    re-read from the database — not to whatever the client believed was
 *    eligible when it rendered the list.
 * 2. Every accepted fact goes through the same single-fact resolve path,
 *    one call each, so a bulk accept still records "an individual action
 *    row per fact" rather than one row for the batch.
 */
export async function bulkAcceptHighConfidence(db: FactLedgerDb, factIds: string[]): Promise<BulkAcceptResult> {
  const facts = await db.getFacts(factIds);
  const byId = new Map(facts.map((fact) => [fact.id, fact]));

  const eligible: LedgerFact[] = [];
  const skipped: string[] = [];
  for (const factId of factIds) {
    const fact = byId.get(factId);
    if (fact && isBulkAcceptable(fact)) {
      eligible.push(fact);
    } else {
      skipped.push(factId);
    }
  }

  for (const fact of eligible) {
    await db.resolveFact({ factId: fact.id, status: "accepted", resolvedValue: null, rejectionReason: null });
  }

  return { accepted: eligible.length, skipped };
}
