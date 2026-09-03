import type { FactValue } from "@/lib/facts/ledger";

/**
 * Correlating facts that describe the same room, occupant list row, or
 * any other repeated entry on one document.
 *
 * A document like an approved drawing or an occupancy schedule lists
 * many rooms, each contributing several facts (a reference, a printed
 * area, printed dimensions). `group_ref` is how one confirmed fact says
 * which entry it belongs to — set at extraction time to the entry's own
 * printed label, and never touched by an assessor's later edit to the
 * fact's *value* (0027_room_area.sql). Grouping by it, rather than by
 * the order facts happen to have been confirmed in, is what keeps this
 * correct after an assessor accepts, edits or rejects facts individually
 * and out of order.
 */
export interface GroupedFact {
  factKey: string;
  groupRef: string | null;
  confirmedValue: FactValue;
  confidence: "high" | "medium" | "low" | null;
}

/** One entry's facts, keyed by fact_key. A document-wide fact (group_ref null) is not an entry and is excluded. */
export type FactGroup = Map<string, GroupedFact>;

/** Groups confirmed facts by group_ref, keeping only the fact keys asked for. */
export function groupFactsByRef(facts: readonly GroupedFact[], factKeys: readonly string[]): Map<string, FactGroup> {
  const wanted = new Set(factKeys);
  const groups = new Map<string, FactGroup>();

  for (const fact of facts) {
    if (fact.groupRef === null || !wanted.has(fact.factKey)) continue;
    const group = groups.get(fact.groupRef) ?? new Map<string, GroupedFact>();
    group.set(fact.factKey, fact);
    groups.set(fact.groupRef, group);
  }

  return groups;
}

function stringValue(group: FactGroup, key: string): string | null {
  const value = group.get(key)?.confirmedValue;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(group: FactGroup, key: string): number | null {
  const value = group.get(key)?.confirmedValue;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function confidenceOf(group: FactGroup, key: string): "high" | "medium" | "low" | null {
  return group.get(key)?.confidence ?? null;
}

export { stringValue as groupStringValue, numberValue as groupNumberValue, confidenceOf as groupConfidence };
