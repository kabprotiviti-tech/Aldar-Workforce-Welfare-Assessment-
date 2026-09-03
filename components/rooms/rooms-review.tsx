"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { evaluateRoomRules, proposeRoomMeasurements, type EvaluateRoomRulesResult, type RoomActionResult } from "@/lib/rooms/actions";
import { RoomMeasurementPanel, type RoomView } from "@/components/rooms/room-measurement-panel";
import { Button } from "@/components/ds/button";
import { EmptyState } from "@/components/ds/empty-state";

export interface AssessmentOption {
  id: string;
  subjectCode: string;
}

export function RoomsReview({ facilityId, rooms, assessments }: { facilityId: string; rooms: RoomView[]; assessments: AssessmentOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState(assessments[0]?.id ?? "");

  function run(action: () => Promise<RoomActionResult | EvaluateRoomRulesResult>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if ("storedCount" in result) {
        setMessage(
          `${result.storedCount} rule result(s) stored.` +
            (result.problems.length > 0 ? ` ${result.problems.length} rule(s) could not run.` : ""),
        );
      } else {
        setMessage("Done.");
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-ds-control border border-ds-line bg-ds-surface-2 px-3 py-2.5">
        {assessments.length > 0 && (
          <>
            <label className="text-xs text-ds-ink-2" htmlFor="propose-assessment">
              Propose from
            </label>
            <select
              id="propose-assessment"
              value={assessmentId}
              onChange={(event) => setAssessmentId(event.target.value)}
              className="ds-focus-ring rounded-ds-control border border-ds-line bg-ds-surface px-2 py-1 text-xs text-ds-ink"
            >
              {assessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {assessment.subjectCode}
                </option>
              ))}
            </select>
            <Button variant="secondary" disabled={pending} onClick={() => run(() => proposeRoomMeasurements(assessmentId, null))}>
              Propose room measurements
            </Button>
          </>
        )}
        <Button disabled={pending} onClick={() => run(() => evaluateRoomRules(facilityId))}>
          Evaluate room rules
        </Button>
      </div>
      {message && <p className="mt-1.5 text-xs text-ds-ink-2">{message}</p>}
      {error && <p className="mt-1.5 text-xs text-ds-warn">{error}</p>}

      {rooms.length === 0 ? (
        <EmptyState
          className="mt-3"
          title="No rooms yet"
          description="Propose room measurements from a confirmed approved drawing, or capture bed and occupancy counts during the on-site inspection."
        />
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {rooms.map((room) => (
            <RoomMeasurementPanel key={room.id} facilityId={facilityId} room={room} onChanged={() => router.refresh()} />
          ))}
        </div>
      )}
    </div>
  );
}
