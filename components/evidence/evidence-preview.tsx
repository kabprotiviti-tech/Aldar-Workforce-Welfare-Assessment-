"use client";

import { useEffect, useState } from "react";
import readXlsxFile from "read-excel-file";
import { getEvidencePreviewUrl } from "@/lib/evidence/actions";
import { EmptyState } from "@/components/ds/empty-state";

export interface PreviewFile {
  storagePath: string;
  originalName: string;
  mimeType: string;
}

type Kind = "pdf" | "image" | "spreadsheet" | "other";

function kindOf(originalName: string, mimeType: string): Kind {
  const extension = originalName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf" || mimeType === "application/pdf") return "pdf";
  if (["jpg", "jpeg", "png"].includes(extension) || mimeType.startsWith("image/")) return "image";
  if (extension === "xlsx") return "spreadsheet";
  return "other";
}

/** Cap on rendered spreadsheet rows — same freeze-avoidance reasoning as the native PDF viewer below, for a pathologically large sheet. */
const SPREADSHEET_ROW_LIMIT = 500;

export function EvidencePreview({ file }: { file: PreviewFile | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [rowsTruncated, setRowsTruncated] = useState(false);

  useEffect(() => {
    // Resetting preview state and loading it from the server for the
    // newly selected file is the external sync this effect exists for —
    // there's no derivable initial value to compute in a lazy useState
    // initializer instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null);
    setError(null);
    setRows(null);
    setRowsTruncated(false);
    if (!file) return;

    let cancelled = false;
    (async () => {
      const result = await getEvidencePreviewUrl(file.storagePath);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setUrl(result.url);

      if (kindOf(file.originalName, file.mimeType) === "spreadsheet") {
        try {
          const response = await fetch(result.url);
          const blob = await response.blob();
          const parsed = await readXlsxFile(blob);
          if (cancelled) return;
          setRowsTruncated(parsed.length > SPREADSHEET_ROW_LIMIT);
          setRows(parsed.slice(0, SPREADSHEET_ROW_LIMIT));
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not read this spreadsheet.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Depends on file's individual fields, not the file object itself —
    // a parent re-render that passes a new object with the same field
    // values shouldn't re-trigger this fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.storagePath, file?.originalName, file?.mimeType]);

  if (!file) {
    return <EmptyState title="No file selected" description="Choose a file from the list to preview it." />;
  }
  if (error) {
    return <p className="text-sm text-ds-bad">{error}</p>;
  }
  if (!url) {
    return <p className="text-sm text-ds-ink-2">Loading preview…</p>;
  }

  const kind = kindOf(file.originalName, file.mimeType);

  if (kind === "pdf") {
    // The browser's own PDF viewer handles pagination and lazy page
    // rendering natively — this is what keeps a 40MB scanned PDF from
    // freezing the tab (this prompt's acceptance criterion): the native
    // viewer streams and paginates itself, rather than this app rendering
    // every page into the DOM up front with a custom canvas-based viewer.
    // See docs/decisions.md.
    return (
      <iframe src={url} title={file.originalName} className="h-full min-h-[70vh] w-full rounded-ds-control border border-ds-line" />
    );
  }

  if (kind === "image") {
    // A signed Supabase Storage URL is a per-deployment, dynamic external
    // host next/image's static remotePatterns config can't name in
    // advance — a plain <img> is the standard, correct choice here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={file.originalName} className="max-h-[70vh] w-full rounded-ds-control border border-ds-line object-contain" />;
  }

  if (kind === "spreadsheet") {
    if (!rows) {
      return <p className="text-sm text-ds-ink-2">Reading spreadsheet…</p>;
    }
    return (
      <div>
        {rowsTruncated && <p className="mb-2 text-xs text-ds-ink-2">Showing the first {SPREADSHEET_ROW_LIMIT} rows.</p>}
        <div className="max-h-[70vh] overflow-auto rounded-ds-control border border-ds-line">
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-ds-line first:border-t-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="whitespace-nowrap px-2 py-1 text-ds-ink">
                      {cell === null || cell === undefined ? "" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <p className="text-sm text-ds-ink-2">
      No preview available for this file type.{" "}
      <a href={url} target="_blank" rel="noreferrer" className="text-ds-accent-2 underline">
        Open / download
      </a>
    </p>
  );
}
