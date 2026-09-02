import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env/client";

/** Anon-key client for use inside client components. Safe to bundle — the anon key is public. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
