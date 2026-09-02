import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Acceptance criterion (this prompt): "No downstream query reads
 * extracted_facts where status = 'proposed'. Enforce this with a database
 * view fact_ledger_confirmed and make it the only read path, proven by a
 * test."
 *
 * The view is the enforcement (0021_fact_ledger.sql — it filters to
 * accepted/edited and doesn't even expose the raw value columns);
 * tests/db/fact-ledger.test.ts proves the view's behaviour against real
 * Postgres. This test proves the other half: that no code anywhere in the
 * app reaches around the view to the raw table, which is the only way the
 * guarantee could be lost in the future.
 *
 * Two modules are allowed to touch extracted_facts directly, and neither
 * is a downstream consumer of confirmed values:
 *  - lib/ai/extract-supabase.ts writes the rows in the first place.
 *  - lib/facts/ledger-supabase.ts is the ledger itself: showing a person
 *    the unreviewed facts is precisely its job.
 */
const ALLOWED_FILES = new Set(["lib/ai/extract-supabase.ts", "lib/facts/ledger-supabase.ts"]);

/**
 * Walks the filesystem rather than `git ls-files` on purpose: a file
 * that hasn't been committed yet is exactly the file most likely to have
 * just introduced a second read path, and the git index wouldn't see it.
 */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, found);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

function appSourceFiles(): string[] {
  return ["app", "components", "lib", "scripts"].flatMap((dir) => sourceFiles(dir));
}

describe("fact_ledger_confirmed is the only read path for facts", () => {
  it("no application module outside the ledger and the extraction writer queries extracted_facts", () => {
    const offenders = appSourceFiles().filter((file) => {
      if (ALLOWED_FILES.has(file)) return false;
      const source = readFileSync(file, "utf8");
      // Matches how this codebase queries a table:
      // supabase.from("extracted_facts") / from('extracted_facts'), and
      // raw SQL naming the table.
      return /from\s*\(\s*["'`]extracted_facts["'`]\s*\)/.test(source) || /\bfrom\s+(public\.)?extracted_facts\b/i.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it("the ledger's own reads are the only ones, and they are the review surface (not a downstream consumer)", () => {
    // Guards the allowlist itself: if one of these files stops existing
    // or stops reading the table, the allowlist above is stale and should
    // shrink rather than silently permit something else later.
    for (const file of ALLOWED_FILES) {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/extracted_facts/);
    }
  });

  it("the view exists in the migrations and filters to confirmed statuses only", () => {
    const migration = readFileSync("supabase/migrations/0021_fact_ledger.sql", "utf8");
    expect(migration).toMatch(/create view public\.fact_ledger_confirmed/);
    expect(migration).toMatch(/where f\.status in \('accepted', 'edited'\)/);
    // security_invoker keeps the view subject to the caller's own RLS
    // rather than the view owner's — without it the view would quietly
    // bypass the staff-only policies on the underlying tables.
    expect(migration).toMatch(/security_invoker = true/);
  });
});
