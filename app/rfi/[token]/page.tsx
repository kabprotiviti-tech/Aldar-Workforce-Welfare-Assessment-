"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ChecklistItem {
  id: string;
  name: string;
  status: "outstanding" | "received" | "waived";
}

interface Checklist {
  subjectCode: string;
  dueDate: string;
  status: string;
  items: ChecklistItem[];
}

/**
 * The tokenised upload portal (this prompt: "no account needed"). Fetches
 * from /api/rfi/[token], the route handler that actually enforces
 * expiry/tampering/rate-limiting (lib/rfi/portal.ts) — this page is just
 * its client-rendered presentation.
 */
export default function RfiPortalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/rfi/${token}`);
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Something went wrong.");
      setChecklist(null);
      return;
    }
    setError(null);
    setChecklist(body.checklist);
  }

  useEffect(() => {
    // Fetching the checklist from the API route on mount (and whenever
    // the token in the URL changes) is the one legitimate external-system
    // sync this effect exists for — there is no derivable initial value
    // to compute in a lazy useState initializer instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleUpload(itemId: string, file: File) {
    setUploadingId(itemId);
    const formData = new FormData();
    formData.set("checklist_item_id", itemId);
    formData.set("file", file);
    const response = await fetch(`/api/rfi/${token}/upload`, { method: "POST", body: formData });
    const body = await response.json();
    setUploadingId(null);
    if (!response.ok) {
      setError(body.error ?? "Upload failed.");
      return;
    }
    await refresh();
  }

  return (
    <div className="min-h-screen bg-ds-bg">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-lg font-semibold text-ds-ink">Document request</h1>

        {error && (
          <div className="mt-4 rounded-ds-card border border-ds-bad bg-ds-surface px-4 py-3 text-sm text-ds-bad">{error}</div>
        )}

        {checklist && (
          <>
            <p className="mt-1 text-sm text-ds-ink-2">
              {checklist.subjectCode} &middot; due {checklist.dueDate}
            </p>

            <div className="mt-6 grid gap-3">
              {checklist.items.map((item) => (
                <div key={item.id} className="rounded-ds-card border border-ds-line bg-ds-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-ds-ink">{item.name}</p>
                    <span
                      className={`text-xs font-medium ${item.status === "received" ? "text-ds-ok" : "text-ds-ink-2"}`}
                    >
                      {item.status === "received" ? "Received" : "Outstanding"}
                    </span>
                  </div>
                  {item.status !== "received" && (
                    <input
                      type="file"
                      disabled={uploadingId === item.id}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) handleUpload(item.id, file);
                      }}
                      className="ds-focus-ring mt-3 block w-full text-sm text-ds-ink"
                    />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
