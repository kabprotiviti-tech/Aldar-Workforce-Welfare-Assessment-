import { describe, expect, it } from "vitest";
import { buildAssessmentTimeline } from "./timeline";

describe("buildAssessmentTimeline", () => {
  it("always includes creation, and nothing else when no milestone has happened yet", () => {
    const events = buildAssessmentTimeline({ createdAt: "2026-01-01T00:00:00Z", qaCompletedAt: null, approvedAt: null, issuedAt: null, revisions: [] });
    expect(events).toEqual([{ kind: "created", at: "2026-01-01T00:00:00Z", label: "Assessment created", detail: null }]);
  });

  it("orders every milestone chronologically regardless of input order", () => {
    const events = buildAssessmentTimeline({
      createdAt: "2026-01-01T00:00:00Z",
      qaCompletedAt: "2026-02-01T00:00:00Z",
      approvedAt: "2026-03-01T00:00:00Z",
      issuedAt: "2026-03-01T00:00:00Z",
      revisions: [],
    });
    expect(events.map((e) => e.kind)).toEqual(["created", "qa_passed", "approved", "issued"]);
  });

  it("includes every revision, with its reason as the detail, interleaved chronologically", () => {
    const events = buildAssessmentTimeline({
      createdAt: "2026-01-01T00:00:00Z",
      qaCompletedAt: "2026-02-01T00:00:00Z",
      approvedAt: "2026-03-01T00:00:00Z",
      issuedAt: "2026-03-01T00:00:00Z",
      revisions: [{ revisionNumber: 2, reason: "Client requested a correction.", revisedAt: "2026-04-01T00:00:00Z" }],
    });
    expect(events[events.length - 1]).toEqual({
      kind: "revision_opened",
      at: "2026-04-01T00:00:00Z",
      label: "Revision 2 opened",
      detail: "Client requested a correction.",
    });
  });

  it("interleaves a revision correctly when it falls before a later milestone", () => {
    const events = buildAssessmentTimeline({
      createdAt: "2026-01-01T00:00:00Z",
      qaCompletedAt: "2026-05-01T00:00:00Z",
      approvedAt: "2026-06-01T00:00:00Z",
      issuedAt: "2026-03-01T00:00:00Z",
      revisions: [{ revisionNumber: 2, reason: "Reopened after first approval.", revisedAt: "2026-04-01T00:00:00Z" }],
    });
    expect(events.map((e) => e.kind)).toEqual(["created", "issued", "revision_opened", "qa_passed", "approved"]);
  });
});
