import { z } from "zod";

/**
 * Env vars safe to read from browser code. Next.js only inlines
 * NEXT_PUBLIC_-prefixed vars into the client bundle, and only via a literal
 * `process.env.NEXT_PUBLIC_X` access (not a dynamic lookup) — so each one is
 * read explicitly below rather than passed through as a spread of
 * `process.env`.
 *
 * The Supabase URL and anon key are not secrets: the anon key is designed to
 * be public and is meaningless without Row Level Security, which is what
 * actually protects data. See lib/env/server.ts for the service-role key,
 * which must never end up here.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

function loadClientEnv() {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }

  return parsed.data;
}

export const clientEnv = loadClientEnv();
