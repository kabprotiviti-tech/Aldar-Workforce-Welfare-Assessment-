/**
 * Rendering the working. Every rule states its arithmetic in words —
 * "26.4 m² / 8 residents = 3.30 m² per resident. Minimum 4.00 m². Below
 * threshold." (this prompt) — which puts a real burden on the number
 * formatting: a displayed figure that contradicts the verdict beside it
 * destroys trust in the whole engine.
 */

export class RuleTemplateError extends Error {}

/**
 * Fills {tokens} in a rule's declared explanation template. Strict on
 * purpose: an unfilled token would ship a literal "{minimum}" into an
 * assessor's screen and a client's report, so a template/vars mismatch
 * fails loudly in tests rather than quietly in production.
 */
export function renderTemplate(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    if (!(token in vars)) {
      throw new RuleTemplateError(`Explanation template references {${token}}, which the rule did not supply.`);
    }
    const value = vars[token]!;
    return typeof value === "number" ? formatNumber(value) : value;
  });
}

/** A number as a person would write it: no trailing zeros, at most `maxDecimals` places. */
export function formatNumber(value: number, maxDecimals = 2): string {
  if (Number.isInteger(value)) return String(value);
  return trimTrailingZeros(value.toFixed(maxDecimals));
}

/** A number at a fixed precision — for thresholds, where "4.00 m²" reads as a stated minimum and "4" reads like a rounding. */
export function formatFixed(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

const MAX_COMPARISON_DECIMALS = 8;

/**
 * A computed value formatted so it can't appear to contradict the verdict
 * it sits next to. At the usual 2 decimal places, 31.99 m² across 8
 * residents renders as "4.00 m² per resident" — identical to a 4.00
 * minimum it actually falls short of. This adds precision until the value
 * and the threshold read differently, so a failing figure always *looks*
 * like it fails.
 */
export function formatComparable(value: number, threshold: number, decimals = 2): string {
  for (let dp = decimals; dp <= MAX_COMPARISON_DECIMALS; dp++) {
    const rendered = value.toFixed(dp);
    if (value === threshold || rendered !== threshold.toFixed(dp)) {
      return rendered;
    }
  }
  return String(value);
}

/** "1 vehicle" / "3 vehicles", without every rule hand-rolling the plural. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Joins a list for prose, with an "and" before the last item. */
export function listPhrase(items: readonly string[]): string {
  if (items.length === 0) return "none";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
