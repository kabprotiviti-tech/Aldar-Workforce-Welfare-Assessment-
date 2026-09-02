import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Appends one row to public.audit_log. Uses the service-role client because
 * the log has to survive the actor's own session (and because normal RLS
 * would let an actor write only rows attributed to themselves) — the audit
 * trail itself is append-only by database policy, not by trusting this
 * function alone. See supabase/migrations/0001_init.sql.
 */
export async function writeAudit(
  actor: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from("audit_log").insert({
    actor_id: actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    before: before ?? null,
    after: after ?? null,
  });

  if (error) {
    throw new Error(`writeAudit failed: ${error.message}`);
  }
}
