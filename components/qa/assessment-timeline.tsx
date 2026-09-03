import { buildAssessmentTimeline, type TimelineEventKind } from "@/lib/qa/timeline";
import { Pill, type PillTone } from "@/components/ds/pill";

const KIND_TONE: Record<TimelineEventKind, PillTone> = {
  created: "neutral",
  qa_passed: "info",
  approved: "ok",
  issued: "ok",
  revision_opened: "warn",
};

/** "Assessment status timeline visible on the assessment header" (this prompt). Presentational only — lib/qa/timeline.ts does the ordering. */
export function AssessmentTimeline({
  createdAt,
  qaCompletedAt,
  approvedAt,
  issuedAt,
  revisions,
}: {
  createdAt: string;
  qaCompletedAt: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  revisions: readonly { revisionNumber: number; reason: string; revisedAt: string }[];
}) {
  const events = buildAssessmentTimeline({ createdAt, qaCompletedAt, approvedAt, issuedAt, revisions });

  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {events.map((event, index) => (
        <li key={`${event.kind}-${event.at}`} className="flex items-center gap-1.5">
          {index > 0 && <span className="text-ds-ink-2">&rarr;</span>}
          <Pill tone={KIND_TONE[event.kind]}>{event.label}</Pill>
          <span className="text-xs text-ds-ink-2">{new Date(event.at).toLocaleDateString()}</span>
        </li>
      ))}
    </ol>
  );
}
