import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "This is code, not AI. No model call may occur in this module." (this
 * prompt.) A comment saying so would not survive a future edit; this
 * fails the build if anything under lib/rules/compliance/ ever imports
 * the AI layer or an SDK, or reaches the network.
 */
const MODULE_DIR = "lib/rules/compliance";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

const FORBIDDEN = [
  { pattern: /@anthropic-ai\/sdk/, why: "the Anthropic SDK" },
  { pattern: /@\/lib\/ai\//, why: "the AI layer (lib/ai)" },
  { pattern: /\bfetch\s*\(/, why: "a network call" },
  { pattern: /\bXMLHttpRequest\b/, why: "a network call" },
  { pattern: /\bcallClaude/i, why: "a model call" },
];

describe("the rule engine contains no model call", () => {
  const files = sourceFiles(MODULE_DIR).filter((file) => !file.endsWith("no-model-call.test.ts"));

  it("finds rule engine source files to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("%s calls no model and reaches no network", (file) => {
    const source = readFileSync(file, "utf8");
    const violations = FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ why }) => why);
    expect(violations).toEqual([]);
  });
});
