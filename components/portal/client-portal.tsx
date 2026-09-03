import { Card } from "@/components/ds/card";
import { Pill, type PillTone } from "@/components/ds/pill";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from "@/components/ds/table";
import { EmptyState } from "@/components/ds/empty-state";

export interface PortalReportRow {
  id: string;
  subjectCode: string;
  moduleLabel: string;
  version: number;
  generatedAt: string;
  downloadUrl: string | null;
}

export interface PortalFindingRow {
  id: string;
  subjectCode: string;
  title: string;
  priority: "high" | "medium" | "low";
  status: string;
  dueDate: string | null;
}

const PRIORITY_TONE: Record<PortalFindingRow["priority"], PillTone> = { high: "bad", medium: "warn", low: "neutral" };

/**
 * The client_viewer portal (this prompt: "approved reports and open
 * findings for their own entity only"). Presentational only — every row
 * here already came through RLS scoped to the signed-in client_viewer's
 * own entity (`reports_select_client_viewer`/`findings_select_client_viewer`,
 * 0007_findings_reports.sql), so no further filtering happens here or in
 * the page that fetches them.
 */
export function ClientPortal({ reports, findings }: { reports: PortalReportRow[]; findings: PortalFindingRow[] }) {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ds-ink">Your assessments</h1>
        <p className="mt-1 text-sm text-ds-ink-2">Approved reports and open findings for your organisation.</p>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">Reports</p>
        <div className="mt-3">
          {reports.length === 0 ? (
            <EmptyState title="No reports issued yet" />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Subject code</TableHeaderCell>
                  <TableHeaderCell>Module</TableHeaderCell>
                  <TableHeaderCell>Version</TableHeaderCell>
                  <TableHeaderCell>Generated</TableHeaderCell>
                  <TableHeaderCell>Download</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>{report.subjectCode}</TableCell>
                    <TableCell>{report.moduleLabel}</TableCell>
                    <TableCell>{report.version}</TableCell>
                    <TableCell>{new Date(report.generatedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {report.downloadUrl ? (
                        <a href={report.downloadUrl} className="ds-focus-ring text-ds-accent-2 hover:underline">
                          Download
                        </a>
                      ) : (
                        <span className="text-ds-ink-2">Unavailable</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-ds-ink">Open findings</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {findings.length === 0 ? (
            <EmptyState title="No open findings" />
          ) : (
            findings.map((finding) => (
              <Card key={finding.id}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ds-ink">{finding.title}</p>
                  <Pill tone={PRIORITY_TONE[finding.priority]}>{finding.priority}</Pill>
                </div>
                <p className="mt-1 text-xs text-ds-ink-2">{finding.subjectCode}</p>
                <p className="mt-2 text-xs text-ds-ink-2">{finding.dueDate ? `Due ${finding.dueDate}` : "No due date set"}</p>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
