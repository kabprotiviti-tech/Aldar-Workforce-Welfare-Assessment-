import "server-only";
import { z } from "zod";
import { clientEnv } from "@/lib/env/client";

/**
 * Server-only environment. Importing "server-only" makes it a build error
 * for any client component to import this module (or anything that imports
 * it, like lib/supabase/admin.ts) — a compile-time backstop on top of the
 * naming/prefix discipline Next.js already enforces for NEXT_PUBLIC_ vars.
 *
 * Naming note: the brief asks to fail loudly if SUPABASE_URL is missing.
 * Next.js can only inline an env var into the browser bundle if it's named
 * NEXT_PUBLIC_*, and the Supabase URL has to reach browser code (for
 * lib/supabase/browser.ts) — so it's declared once as
 * NEXT_PUBLIC_SUPABASE_URL (validated in lib/env/client.ts) and re-checked
 * here rather than duplicated under a second, server-only name. The value
 * isn't secret either way; only the check needed to happen at boot, which it
 * does below.
 */
const serverEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  /**
   * Authenticates app/api/rfi/reminders — a Vercel Cron trigger, not a
   * signed-in user, so there's no Supabase session to gate it with.
   * Optional here (deploys without a reminder schedule configured yet
   * shouldn't fail to boot) but the route itself refuses every request
   * when it's unset, rather than running unauthenticated. See
   * docs/decisions.md.
   */
  CRON_SECRET: z.string().min(1).optional(),
});

function loadServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }

  return {
    ...parsed.data,
    // Re-exported from clientEnv so callers get one object with everything
    // server code needs, and so importing this module is enough to also
    // guarantee the Supabase URL/anon key were validated.
    NEXT_PUBLIC_SUPABASE_URL: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export const serverEnv = loadServerEnv();
