"use client";

import { useState } from "react";
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

export interface EvidenceLibraryProps {
  assessmentId: string;
  subjectCode: string;
  entityName: string;
  requirements: RequirementData[];
  files: EvidenceFileData[];
  links: LinkData[];
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

export function EvidenceLibrary({ assessmentId, subjectCode, entityName, requirements, files, links }: EvidenceLibraryProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(files[0]?.id ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const selectedFile = files.find((f) => f.id === selectedId) ?? null;
  const linkedRequirementIds = new Set(links.filter((l) => l.evidenceFileId === selectedId).map((l) => l.requirementId));

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

        <div className="mt-3 grid gap-1.5">
          {files.length === 0 ? (
            <p className="text-sm text-ds-ink-2">No files uploaded yet.</p>
          ) : (
            files.map((file) => (
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
                <Pill tone={REVIEW_STATUS_TONE[file.reviewStatus] ?? "neutral"} className="mt-1.5">
                  {REVIEW_STATUS_LABELS[file.reviewStatus as keyof typeof REVIEW_STATUS_LABELS] ?? file.reviewStatus}
                </Pill>
              </button>
            ))
          )}
        </div>
      </div>

      <div>
        <EvidencePreview file={selectedFile ? { storagePath: selectedFile.storagePath, originalName: selectedFile.originalName, mimeType: selectedFile.mimeType } : null} />

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
