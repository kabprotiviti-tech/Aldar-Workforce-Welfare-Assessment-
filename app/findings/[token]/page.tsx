"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface PortalFinding {
  title: string;
  subjectCode: string;
  requirementTitle: string;
  status: string;
  priority: string;
  dueDate: string | null;
  ownerName: string | null;
  closureNote: string | null;
}

/**
 * The closure portal (this prompt: "same tokenised pattern as the RFI
 * portal — no account needed"). Fetches from /api/findings/[token], the
 * route handler that actually enforces expiry/tampering/rate-limiting
 * (lib/findings/closure-portal.ts) — this page is just its client-
 * rendered presentation, mirroring app/rfi/[token]/page.tsx.
 */
export default function FindingClosurePortalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [finding, setFinding] = useState<PortalFinding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function refresh() {
    const response = await fetch(`/api/findings/${token}`);
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Something went wrong.");
      setFinding(null);
      return;
    }
    setError(null);
    setFinding(body.finding);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSubmit(file: File) {
    setSubmitting(true);
    const formData = new FormData();
    formData.set("note", note);
    formData.set("file", file);
    const response = await fetch(`/api/findings/${token}/upload`, { method: "POST", body: formData });
    const body = await response.json();
    setSubmitting(false);
    if (!response.ok) {
      setError(body.error ?? "Submission failed.");
      return;
    }
    setSubmitted(true);
    await refresh();
  }

  return (
    <div className="min-h-screen bg-ds-bg">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-lg font-semibold text-ds-ink">Finding closure</h1>

        {error && (
          <div className="mt-4 rounded-ds-card border border-ds-bad bg-ds-surface px-4 py-3 text-sm text-ds-bad">{error}</div>
        )}

        {finding && (
          <>
            <p className="mt-1 text-sm text-ds-ink-2">
              {finding.subjectCode} &middot; {finding.requirementTitle}
            </p>
            <div className="mt-4 rounded-ds-card border border-ds-line bg-ds-surface p-4">
              <p className="text-sm font-medium text-ds-ink">{finding.title}</p>
              {finding.dueDate && <p className="mt-1 text-xs text-ds-ink-2">Due {finding.dueDate}</p>}
            </div>

            {finding.status === "closed" ? (
              <p className="mt-6 text-sm text-ds-ok">This finding has been closed.</p>
            ) : submitted ? (
              <p className="mt-6 text-sm text-ds-ok">Submitted — a reviewer will confirm closure.</p>
            ) : (
              <div className="mt-6 grid gap-3">
                <label className="text-sm font-medium text-ds-ink" htmlFor="closure-note">
                  Note
                </label>
                <textarea
                  id="closure-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="ds-focus-ring rounded-ds-card border border-ds-line bg-ds-bg p-3 text-sm text-ds-ink"
                  rows={4}
                  placeholder="Describe what was done to close this finding."
                />
                <input
                  type="file"
                  disabled={submitting || note.trim().length === 0}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleSubmit(file);
                  }}
                  className="ds-focus-ring block w-full text-sm text-ds-ink"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
