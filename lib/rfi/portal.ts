import {
  hashPortalToken,
  isRateLimited,
  validateToken,
  RATE_LIMIT_WINDOW_MS,
  type TokenRecord,
} from "@/lib/rfi/token";
import type { RfiTokenAccessOutcome } from "@/lib/db/rfi";
import type { VirusScanVerdict } from "@/lib/rfi/virus-scan";

export interface PortalChecklistItem {
  id: string;
  name: string;
  status: "outstanding" | "received" | "waived";
  requirementId: string;
}

export interface PortalChecklist {
  requestId: string;
  assessmentId: string;
  subjectCode: string;
  contactId: string;
  dueDate: string;
  status: string;
  items: PortalChecklistItem[];
}

export interface RecordUploadInput {
  checklistItemId: string;
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  virusScanStatus: VirusScanVerdict;
}

export interface RecordUploadResult {
  evidenceFileId: string;
}

/**
 * The RFI portal's data access, as a small explicit port — same reasoning
 * as lib/scheduling/generate-cycle.ts's GenerateCycleDb: the acceptance
 * criteria here ("expired or tampered token returns 403 and is logged",
 * "uploading ... creates an evidence_files row linked to the assessment
 * and the requirement, with the uploader recorded as the entity contact")
 * are about this logic's *behaviour*, not about Supabase Storage bytes —
 * isolating them behind an interface lets that behaviour be proven
 * against a real local Postgres instance (tests/db/rfi-portal.test.ts)
 * without needing live Storage, the same way generate-cycle.perf.test.ts
 * doesn't need a live Supabase project either.
 */
export interface RfiPortalDb {
  findTokenRecord(tokenHash: string): Promise<TokenRecord | null>;
  recentAttemptTimestamps(tokenHash: string, sinceIso: string): Promise<Date[]>;
  logAttempt(tokenHash: string, ip: string | null, outcome: RfiTokenAccessOutcome): Promise<void>;
  getChecklist(requestId: string): Promise<PortalChecklist | null>;
  getChecklistItemRequestId(checklistItemId: string): Promise<string | null>;
  recordUpload(input: RecordUploadInput): Promise<RecordUploadResult>;
}

export type PortalAccessResult =
  | { ok: true; requestId: string }
  | { ok: false; status: 403 | 429; reason: string };

/**
 * Rate-limits, then validates, a presented token — logging every outcome
 * (this prompt's "is logged" half of the 403 requirement). Rate limiting
 * is checked first and does not itself require a valid token, so a flood
 * of guesses against one hash is rejected before a single database lookup
 * for token validity even runs.
 */
export async function checkPortalAccess(db: RfiPortalDb, token: string, ip: string | null, now: Date): Promise<PortalAccessResult> {
  const tokenHash = hashPortalToken(token);

  const since = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const recent = await db.recentAttemptTimestamps(tokenHash, since);
  if (isRateLimited(recent, now)) {
    await db.logAttempt(tokenHash, ip, "rate_limited");
    return { ok: false, status: 429, reason: "Too many attempts. Try again later." };
  }

  const record = await db.findTokenRecord(tokenHash);
  const result = validateToken(record, now);

  if (!result.ok) {
    await db.logAttempt(tokenHash, ip, result.reason);
    return { ok: false, status: 403, reason: "This link is invalid or has expired." };
  }

  await db.logAttempt(tokenHash, ip, "success");
  return { ok: true, requestId: result.requestId };
}

export type PortalChecklistResult =
  | { ok: false; status: 403 | 429; reason: string }
  | { ok: true; requestId: string; checklist: PortalChecklist };

export async function getPortalChecklist(db: RfiPortalDb, token: string, ip: string | null, now: Date): Promise<PortalChecklistResult> {
  const access = await checkPortalAccess(db, token, ip, now);
  if (!access.ok) return access;

  const checklist = await db.getChecklist(access.requestId);
  if (!checklist) {
    return { ok: false, status: 403, reason: "This link is invalid or has expired." };
  }
  return { ok: true, requestId: access.requestId, checklist };
}

export type PortalUploadResult =
  | { ok: false; status: 403 | 429; reason: string }
  | { ok: true; evidenceFileId: string };

export async function submitPortalUpload(
  db: RfiPortalDb,
  token: string,
  ip: string | null,
  now: Date,
  upload: RecordUploadInput,
): Promise<PortalUploadResult> {
  const access = await checkPortalAccess(db, token, ip, now);
  if (!access.ok) return access;

  const checklistItemRequestId = await db.getChecklistItemRequestId(upload.checklistItemId);
  if (checklistItemRequestId !== access.requestId) {
    // The checklist line doesn't belong to this token's own request — reject the same way an invalid token would.
    return { ok: false, status: 403, reason: "This link is invalid or has expired." };
  }

  const result = await db.recordUpload(upload);
  return { ok: true, evidenceFileId: result.evidenceFileId };
}

