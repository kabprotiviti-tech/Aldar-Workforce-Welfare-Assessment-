"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  requestEvidenceUpload,
  confirmEvidenceUpload,
  updateReviewStatus,
  updateDocumentClass,
  linkRequirement,
  unlinkRequirement,
} from "@/lib/evidence/actions";
import { DOCUMENT_CLASSES } from "@/lib/evidence/classify";
import { DOCUMENT_CLASS_LABELS, REVIEW_STATUS_LABELS } from "@/lib/evidence/labels";
import { computeCoverage, requirementsWithNoEvidence } from "@/lib/evidence/coverage";
import { Tabs } from "@/components/ds/tabs";
import { Pill, type PillTone } from "@/components/ds/pill";
import { EmptyState } from "@/components/ds/empty-state";
import { Button } from "@/components/ds/button";
import { ProgressBar } from "@/components/ds/progress-bar";
import { EvidencePreview } from "@/components/evidence/evidence-preview";

export interface EvidenceFileData {
  id: string;
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  documentClass: string | null;
  reviewStatus: string;
  uploadedAt: string;
}

export interface RequirementData {
  id: string;
  slNo: number;
  title: string;
}

export interface LinkData {
  evidenceFileId: string;
  requirementId: string;
}

/** The most recent extraction attempt for one evidence file, if any. */
export interface ExtractionSummaryData {
  evidenceFileId: string;
  costUsd: number | null;
  error: string | null;
  factCount: number;
}

export interface EvidenceLibraryProps {
  assessmentId: string;
  subjectCode: string;
  entityName: string;
  requirements: RequirementData[];
  files: EvidenceFileData[];
  links: LinkData[];
  extractions: ExtractionSummaryData[];
}

interface BatchProgressState {
  batchId: string;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  done: boolean;
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(costUsd < 0.01 ? 6 : 4)}`;
}

/** Starts a batch extraction (POST /api/ai/batches) and polls its progress (GET /api/ai/batches/[id]) until done. */
function useExtractionBatch(assessmentId: string, onDone: () => void) {
  const [batch, setBatch] = useState<BatchProgressState | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function pollBatch(batchId: string) {
    pollRef.current = setInterval(async () => {
      const response = await fetch(`/api/ai/batches/${batchId}`);
      if (!response.ok) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      const body = await response.json();
      setBatch({
        batchId,
        total: body.total,
        queued: body.queued,
        running: body.running,
        succeeded: body.succeeded,
        failed: body.failed,
        done: body.done,
      });
      if (body.done) {
        if (pollRef.current) clearInterval(pollRef.current);
        onDone();
      }
    }, 2000);
  }

  async function start(evidenceFileIds: string[]) {
    setStartError(null);
    const response = await fetch("/api/ai/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentId, evidenceFileIds }),
    });
    const body = await response.json();
    if (!response.ok) {
      setStartError(body.error ?? "Could not start extraction.");
      return;
    }
    setBatch({ batchId: body.batchId, total: body.jobCount, queued: body.jobCount, running: 0, succeeded: 0, failed: 0, done: false });
    pollBatch(body.batchId);
  }

  const extracting = batch !== null && !batch.done;
  return { batch, extracting, startError, start };
}

const REVIEW_STATUS_TONE: Record<string, PillTone> = {
  outstanding: "neutral",
  received: "info",
  in_review: "warn",
  reviewed: "ok",
  gap_flagged: "bad",
};

function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function EvidenceLibrary({ assessmentId, subjectCode, entityName, requirements, files, links, extractions }: EvidenceLibraryProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(files[0]?.id ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const { batch, extracting, startError, start } = useExtractionBatch(assessmentId, () => router.refresh());

  const selectedFile = files.find((f) => f.id === selectedId) ?? null;
  const linkedRequirementIds = new Set(links.filter((l) => l.evidenceFileId === selectedId).map((l) => l.requirementId));
  const extractionByFile = new Map(extractions.map((e) => [e.evidenceFileId, e]));

  async function handleFiles(fileList: FileList) {
    setUploadErrors([]);
    setUploading(true);
    const errors: string[] = [];
    let lastUploadedId: string | null = null;

    for (const file of Array.from(fileList)) {
      const requested = await requestEvidenceUpload(assessmentId, {
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!requested.ok) {
        errors.push(`${file.name}: ${requested.message}`);
        continue;
      }

      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("evidence")
        .uploadToSignedUrl(requested.path, requested.token, file, { contentType: file.type || undefined });
      if (uploadError) {
        errors.push(`${file.name}: ${uploadError.message}`);
        continue;
      }

      const confirmed = await confirmEvidenceUpload(assessmentId, {
        path: requested.path,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        documentClass: requested.proposedDocumentClass,
        requirementIds: [],
      });
      if (!confirmed.ok) {
        errors.push(`${file.name}: ${confirmed.message}`);
        continue;
      }
      lastUploadedId = confirmed.evidenceFileId;
    }

    setUploadErrors(errors);
    setUploading(false);
    if (lastUploadedId) setSelectedId(lastUploadedId);
    router.refresh();
  }

  const coverage = computeCoverage(
    requirements.map((r) => ({ requirementId: r.id, slNo: r.slNo, title: r.title })),
    new Set(links.map((l) => l.requirementId)),
  );
  const gaps = requirementsWithNoEvidence(coverage);

  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Evidence library</h1>
      <p className="mt-1 text-sm text-ds-ink-2">
        {subjectCode} &middot; {entityName}
      </p>

      <Tabs
        className="mt-6"
        items={[
          {
            id: "library",
            label: "Library",
            content: (
              <ThreePanelLibrary
                assessmentId={assessmentId}
                files={files}
                requirements={requirements}
                selectedFile={selectedFile}
                selectedId={selectedId}
                onSelect={setSelectedId}
                uploading={uploading}
                uploadErrors={uploadErrors}
                onFiles={handleFiles}
                linkedRequirementIds={linkedRequirementIds}
                router={router}
                extractionByFile={extractionByFile}
                batch={batch}
                extracting={extracting}
                startError={startError}
                onExtract={start}
              />
            ),
          },
          {
            id: "coverage",
            label: `Coverage${gaps.length > 0 ? ` (${gaps.length} gap${gaps.length === 1 ? "" : "s"})` : ""}`,
            content: <CoveragePanel coverage={coverage} />,
          },
        ]}
      />
    </div>
  );
}

function ThreePanelLibrary({
  assessmentId,
  files,
  requirements,
  selectedFile,
  selectedId,
  onSelect,
  uploading,
  uploadErrors,
  onFiles,
  linkedRequirementIds,
  router,
  extractionByFile,
  batch,
  extracting,
  startError,
  onExtract,
}: {
  assessmentId: string;
  files: EvidenceFileData[];
  requirements: RequirementData[];
  selectedFile: EvidenceFileData | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  uploading: boolean;
  uploadErrors: string[];
  onFiles: (files: FileList) => void;
  linkedRequirementIds: Set<string>;
  router: ReturnType<typeof useRouter>;
  extractionByFile: Map<string, ExtractionSummaryData>;
  batch: BatchProgressState | null;
  extracting: boolean;
  startError: string | null;
  onExtract: (evidenceFileIds: string[]) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr_260px]">
      <div>
        <label className="ds-focus-ring block cursor-pointer rounded-ds-control border border-dashed border-ds-line bg-ds-surface-2 px-3 py-3 text-center text-sm text-ds-ink-2 hover:border-ds-accent">
          {uploading ? "Uploading…" : "Upload files"}
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx,.zip"
            disabled={uploading}
            className="hidden"
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                onFiles(event.target.files);
                event.target.value = "";
              }
            }}
          />
        </label>

        {uploadErrors.length > 0 && (
          <div className="mt-2 grid gap-1 rounded-ds-control border border-ds-bad bg-ds-surface px-3 py-2 text-xs text-ds-bad">
            {uploadErrors.map((message, index) => (
              <p key={index}>{message}</p>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <Button
            variant="secondary"
            className="mt-3 w-full"
            disabled={extracting}
            onClick={() => onExtract(files.map((f) => f.id))}
          >
            {extracting ? "Extracting…" : "Extract all"}
          </Button>
        )}

        {batch && (
          <ProgressBar
            className="mt-2"
            label={batch.done ? `Extraction complete — ${batch.succeeded} succeeded, ${batch.failed} failed` : `Extracting ${batch.succeeded + batch.failed} of ${batch.total}…`}
            value={batch.total === 0 ? 0 : Math.round(((batch.succeeded + batch.failed) / batch.total) * 100)}
          />
        )}

        {startError && <p className="mt-2 text-xs text-ds-bad">{startError}</p>}

        <div className="mt-3 grid gap-1.5">
          {files.length === 0 ? (
            <p className="text-sm text-ds-ink-2">No files uploaded yet.</p>
          ) : (
            files.map((file) => {
              const extraction = extractionByFile.get(file.id);
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => onSelect(file.id)}
                  className={`ds-focus-ring rounded-ds-control border px-3 py-2 text-left text-sm transition-colors duration-150 ${
                    file.id === selectedId
                      ? "border-ds-accent bg-ds-accent-soft"
                      : "border-ds-line bg-ds-surface hover:border-ds-accent"
                  }`}
                >
                  <p className="truncate font-medium text-ds-ink">{file.originalName}</p>
                  <p className="mt-0.5 text-xs text-ds-ink-2">
                    {file.documentClass ? DOCUMENT_CLASS_LABELS[file.documentClass as keyof typeof DOCUMENT_CLASS_LABELS] ?? file.documentClass : "Unclassified"}
                    {" · "}
                    {new Date(file.uploadedAt).toLocaleDateString()}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Pill tone={REVIEW_STATUS_TONE[file.reviewStatus] ?? "neutral"}>
                      {REVIEW_STATUS_LABELS[file.reviewStatus as keyof typeof REVIEW_STATUS_LABELS] ?? file.reviewStatus}
                    </Pill>
                    {extraction?.error && <Pill tone="bad">Extraction failed</Pill>}
                    {!extraction?.error && extraction?.costUsd != null && <Pill tone="info">{formatCost(extraction.costUsd)}</Pill>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div>
        <EvidencePreview file={selectedFile ? { storagePath: selectedFile.storagePath, originalName: selectedFile.originalName, mimeType: selectedFile.mimeType } : null} />

        {selectedFile && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-ds-control border border-ds-line bg-ds-surface-2 px-3 py-2.5">
            <div className="text-sm">
              {(() => {
                const extraction = extractionByFile.get(selectedFile.id);
                if (extraction?.error) {
                  return <p className="text-ds-bad">Extraction failed, review manually.</p>;
                }
                if (extraction?.costUsd != null) {
                  return (
                    <p className="text-ds-ink-2">
                      {extraction.factCount} fact{extraction.factCount === 1 ? "" : "s"} extracted &middot; {formatCost(extraction.costUsd)}
                    </p>
                  );
                }
                return <p className="text-ds-ink-2">Not extracted yet.</p>;
              })()}
            </div>
            <Button variant="secondary" disabled={extracting} onClick={() => onExtract([selectedFile.id])}>
              {extracting ? "Extracting…" : "Extract facts"}
            </Button>
          </div>
        )}

        {selectedFile && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-ds-ink" htmlFor="document-class">
                Document type
              </label>
              <select
                id="document-class"
                defaultValue={selectedFile.documentClass ?? ""}
                onChange={async (event) => {
                  await updateDocumentClass(selectedFile.id, assessmentId, event.target.value);
                  router.refresh();
                }}
                className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
              >
                <option value="" disabled>
                  Choose a type
                </option>
                {DOCUMENT_CLASSES.map((documentClass) => (
                  <option key={documentClass} value={documentClass}>
                    {DOCUMENT_CLASS_LABELS[documentClass]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-ds-ink" htmlFor="review-status">
                Review status
              </label>
              <select
                id="review-status"
                defaultValue={selectedFile.reviewStatus}
                onChange={async (event) => {
                  await updateReviewStatus(selectedFile.id, assessmentId, event.target.value);
                  router.refresh();
                }}
                className="ds-focus-ring mt-1.5 w-full rounded-ds-control border border-ds-line bg-ds-surface px-3 py-2 text-sm text-ds-ink"
              >
                {Object.entries(REVIEW_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-ds-ink">Evidences</p>
              <p className="mt-0.5 text-xs text-ds-ink-2">{formatSize(selectedFile.sizeBytes)}</p>
              <div className="mt-2 grid max-h-40 gap-1 overflow-y-auto">
                {requirements.map((requirement) => {
                  const checked = linkedRequirementIds.has(requirement.id);
                  return (
                    <label key={requirement.id} className="flex items-start gap-2 text-sm text-ds-ink-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        className="ds-focus-ring mt-0.5"
                        onChange={async (event) => {
                          if (event.target.checked) {
                            await linkRequirement(selectedFile.id, assessmentId, requirement.id);
                          } else {
                            await unlinkRequirement(selectedFile.id, assessmentId, requirement.id);
                          }
                          router.refresh();
                        }}
                      />
                      {requirement.slNo}. {requirement.title}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-ds-card border border-dashed border-ds-line bg-ds-surface-2 p-4">
        <EmptyState title="Observations" description="Reserved for a future prompt." />
      </div>
    </div>
  );
}

function CoveragePanel({ coverage }: { coverage: ReturnType<typeof computeCoverage> }) {
  if (coverage.length === 0) {
    return <EmptyState title="No requirements" description="This assessment's template has no requirements yet." />;
  }
  return (
    <div className="grid gap-1.5">
      {coverage.map((row) => (
        <div
          key={row.requirementId}
          className={`flex items-center justify-between gap-3 rounded-ds-control border px-3 py-2 text-sm ${
            row.hasEvidence ? "border-ds-line bg-ds-surface" : "border-ds-bad bg-ds-surface"
          }`}
        >
          <span className="text-ds-ink">
            {row.slNo}. {row.title}
          </span>
          <Pill tone={row.hasEvidence ? "ok" : "bad"}>{row.hasEvidence ? "Covered" : "No evidence"}</Pill>
        </div>
      ))}
    </div>
  );
}
