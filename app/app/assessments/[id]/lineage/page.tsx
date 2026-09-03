import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAssessmentLineage } from "@/lib/dashboard/monitoring-supabase";
import type { LineageEventKind } from "@/lib/dashboard/monitoring";
import { Card } from "@/components/ds/card";
import { Pill, type PillTone } from "@/components/ds/pill";
import { EmptyState } from "@/components/ds/empty-state";

const KIND_TONE: Record<LineageEventKind, PillTone> = {
  rfi_issued: "info",
  rfi_completed: "ok",
  evidence_uploaded: "neutral",
  item_decided: "neutral",
  finding_raised: "warn",
  finding_closed: "ok",
  report_generated: "info",
  report_issued: "ok",
};

/**
 * "A full lineage view" (this prompt) — everything stored about one
 * assessment's real progress, RFI through to report, in one
 * chronological trail. Broader than AssessmentTimeline (the governance-
 * only created/QA/approved/issued view already on the assessment page)
 * — this pulls in RFIs, evidence, per-requirement decisions and
 * findings too. lib/dashboard/monitoring.ts does the ordering; this
 * page only labels and presents it.
 */
export default async function AssessmentLineagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: assessment } = await supabase.from("assessments").select("id, subject_code").eq("id", id).maybeSingle();
  if (!assessment) {
    notFound();
  }

  const events = await loadAssessmentLineage(supabase, id);

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">Lineage — {assessment.subject_code}</h1>
        <p className="mt-1 text-sm text-ds-ink-2">Every stored event for this assessment, in order.</p>
      </div>

      {events.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Events appear here as the assessment progresses." />
      ) : (
        <Card>
          <ol className="grid gap-4">
            {events.map((event, index) => (
              <li key={`${event.kind}-${event.at}-${index}`} className="flex items-start gap-3 border-l-2 border-ds-line pl-4">
                <div className="grid gap-1">
                  <div className="flex items-center gap-2">
                    <Pill tone={KIND_TONE[event.kind]}>{event.label}</Pill>
                    <span className="text-xs text-ds-ink-2">{new Date(event.at).toLocaleString()}</span>
                  </div>
                  {event.detail && <p className="text-sm text-ds-ink-2">{event.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
