import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";

/**
 * Service-role client. Bypasses RLS entirely — use only for privileged,
 * server-only operations (writeAudit, admin provisioning), never to serve a
 * normal user request. The "server-only" import above makes it a build
 * error for this module, or anything that imports it, to reach a client
 * component.
 */
export function createSupabaseAdminClient() {
  return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
