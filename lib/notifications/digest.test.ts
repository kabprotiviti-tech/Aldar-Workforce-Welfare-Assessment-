import { describe, expect, it } from "vitest";
import type { Signal } from "@/lib/dashboard/signals";
import { buildDigestEmail } from "./digest";

function signal(kind: Signal["kind"], title: string, items: Signal["items"]): Signal {
  return { kind, title, query: "test query", items };
}

describe("buildDigestEmail", () => {
  it("says nothing needs attention when every signal is empty", () => {
    const email = buildDigestEmail("Jane", [signal("overdue_action", "Overdue actions", [])]);
    expect(email.subject).toBe("Daily digest — nothing needs attention");
    expect(email.text).toContain("Hi Jane");
    expect(email.text).toContain("Nothing on your portfolio needs attention today.");
  });

  it("lists every non-empty signal with its items, and counts the total in the subject", () => {
    const email = buildDigestEmail("Jane", [
      signal("overdue_action", "Overdue actions", [{ id: "f1", label: "Late wages", detail: "2026-EP-IN-1", href: "/x" }]),
      signal("evidence_awaiting_review", "Evidence awaiting review", []),
      signal(
        "repeat_finding",
        "Repeat findings",
        [
          { id: "f2", label: "Recurring passport issue", detail: "2026-EP-IN-2", href: "/y" },
          { id: "f3", label: "Recurring wage issue", detail: "2026-EP-IN-3", href: "/z" },
        ],
      ),
    ]);
    expect(email.subject).toBe("Daily digest — 3 items need attention");
    expect(email.text).toContain("Overdue actions (1):");
    expect(email.text).toContain("Late wages — 2026-EP-IN-1");
    expect(email.text).toContain("Repeat findings (2):");
    expect(email.text).not.toContain("Evidence awaiting review");
  });

  it("uses singular 'item' for exactly one", () => {
    const email = buildDigestEmail("Jane", [signal("overdue_action", "Overdue actions", [{ id: "f1", label: "X", detail: "Y", href: "/x" }])]);
    expect(email.subject).toBe("Daily digest — 1 item needs attention");
  });
});
