/**
 * Hard backstop for this prompt's "Do not: let the model output any field
 * named status, rating, compliant, or score." The system prompt asks the
 * model not to (lib/ai/prompts/shared.ts), but a prompt instruction is
 * not enforcement — this walks the actually-returned JSON and rejects it
 * if any object anywhere carries one of these keys, regardless of
 * nesting. Case-insensitive: a model writing "Status" or "SCORE" is still
 * a violation.
 */
export const FORBIDDEN_FIELD_NAMES = ["status", "rating", "compliant", "score"] as const;

const FORBIDDEN_SET = new Set<string>(FORBIDDEN_FIELD_NAMES);

/** Returns a dotted path to the first forbidden field found, or null if none. */
export function findForbiddenField(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findForbiddenField(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_SET.has(key.toLowerCase())) {
        return childPath;
      }
      const found = findForbiddenField(child, childPath);
      if (found) return found;
    }
  }

  return null;
}
