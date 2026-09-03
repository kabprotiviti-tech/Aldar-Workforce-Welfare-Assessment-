import {
  hashPortalToken,
  isRateLimited,
  validateToken,
  RATE_LIMIT_WINDOW_MS,
  type TokenRecord,
} from "@/lib/rfi/token";
import { statusAfterClosureSubmitted, canSubmitClosureEvidence } from "@/lib/findings/lifecycle";
import type { VirusScanVerdict } from "@/lib/rfi/virus-scan";

/**
 * The entity-facing closure portal (this prompt: "same tokenised pattern
 * as the RFI portal"). Reuses lib/rfi/token.ts's hash/validate/rate-limit
 * primitives directly rather than reimplementing them — they were
 * already generic (no RFI-specific shape), only their home directory
 * suggests otherwise. Everything below this line is closure-specific:
 * what a finding owner may see and do with a valid token.
 */

export type ClosureTokenAccessOutcome = "success" | "invalid" | "expired" | "revoked" | "rate_limited";

/** Longer than the RFI portal's 21 days — closure evidence (a remediation, not a document handover) routinely takes longer to assemble. */
export const CLOSURE_TOKEN_TTL_DAYS = 30;

export function closureTokenExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + CLOSURE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export interface PortalFinding {
  findingId: string;
  title: string;
  subjectCode: string;
  requirementTitle: string;
  status: string;
  priority: string;
  dueDate: string | null;
  ownerName: string | null;
  closureNote: string | null;
}

export interface RecordClosureSubmissionInput {
  findingId: string;
  note: string;
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  virusScanStatus: VirusScanVerdict;
}

export interface RecordClosureSubmissionResult {
  evidenceFileId: string;
}

/**
 * The closure portal's data access, as a small explicit port — same
 * reasoning as lib/rfi/portal.ts's RfiPortalDb: isolating it behind an
 * interface lets the access-control behaviour (rate limiting, token
 * validation, the 403-and-logged contract) be proven against a real
 * local Postgres instance without live Storage.
 */
export interface FindingClosurePortalDb {
  findTokenRecord(tokenHash: string): Promise<TokenRecord | null>;
  recentAttemptTimestamps(tokenHash: string, sinceIso: string): Promise<Date[]>;
  logAttempt(tokenHash: string, ip: string | null, outcome: ClosureTokenAccessOutcome): Promise<void>;
  getFinding(findingId: string): Promise<PortalFinding | null>;
  recordClosureSubmission(input: RecordClosureSubmissionInput): Promise<RecordClosureSubmissionResult>;
}

export type PortalAccessResult = { ok: true; findingId: string } | { ok: false; status: 403 | 429; reason: string };

/** Rate-limits, then validates, a presented token — logging every outcome. See lib/rfi/portal.ts's checkPortalAccess. */
export async function checkClosurePortalAccess(db: FindingClosurePortalDb, token: string, ip: string | null, now: Date): Promise<PortalAccessResult> {
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
  return { ok: true, findingId: result.requestId };
}

export type PortalFindingResult = { ok: false; status: 403 | 429; reason: string } | { ok: true; finding: PortalFinding };

export async function getPortalFinding(db: FindingClosurePortalDb, token: string, ip: string | null, now: Date): Promise<PortalFindingResult> {
  const access = await checkClosurePortalAccess(db, token, ip, now);
  if (!access.ok) return access;

  const finding = await db.getFinding(access.findingId);
  if (!finding) {
    return { ok: false, status: 403, reason: "This link is invalid or has expired." };
  }
  return { ok: true, finding };
}

export type PortalClosureSubmissionResult = { ok: false; status: 400 | 403 | 429; reason: string } | { ok: true; evidenceFileId: string };

/**
 * "Uploads closure evidence, adds a note" (this prompt) — one atomic
 * submission. Rejected once the finding is already closed: there's
 * nothing left for the owner to submit against.
 */
export async function submitPortalClosure(
  db: FindingClosurePortalDb,
  token: string,
  ip: string | null,
  now: Date,
  submission: Omit<RecordClosureSubmissionInput, "findingId">,
): Promise<PortalClosureSubmissionResult> {
  const access = await checkClosurePortalAccess(db, token, ip, now);
  if (!access.ok) return access;

  const finding = await db.getFinding(access.findingId);
  if (!finding) {
    return { ok: false, status: 403, reason: "This link is invalid or has expired." };
  }
  if (!canSubmitClosureEvidence(finding.status as Parameters<typeof canSubmitClosureEvidence>[0])) {
    return { ok: false, status: 400, reason: "This finding is already closed." };
  }

  const result = await db.recordClosureSubmission({ findingId: access.findingId, ...submission });
  return { ok: true, evidenceFileId: result.evidenceFileId };
}

/** What submitting a closure moves the finding's status to — exported so the Supabase adapter never re-derives it. */
export const CLOSURE_SUBMITTED_STATUS = statusAfterClosureSubmitted();
