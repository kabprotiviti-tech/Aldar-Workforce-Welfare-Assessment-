/**
 * Runs once when a Next.js server instance starts (dev or production) —
 * before any request is served. Importing lib/env/server triggers its
 * top-level Zod validation immediately, so a missing ANTHROPIC_API_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_SUPABASE_URL/ANON_KEY crashes
 * the server at boot with a clear message instead of failing silently on
 * the first request that happens to need it.
 */
export async function register() {
  await import("@/lib/env/server");
}
