import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env/client";

/**
 * Anon-key client for Server Components, Server Actions, and Route
 * Handlers. Runs as the signed-in user (via their session cookie) and is
 * subject to RLS — this is the client every normal request-scoped read or
 * write should use, never the admin client in lib/supabase/admin.ts.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component render, which can't set cookies.
          // middleware.ts refreshes the session on the next request instead.
        }
      },
    },
  });
}
