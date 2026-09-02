import { randomBytes, createHash } from "node:crypto";

/**
 * RFI portal tokens (this prompt: "a tokenised upload portal ... no
 * account needed, link expires"). Only the SHA-256 hash of a token is
 * ever stored (rfi_tokens.token_hash) — the raw value exists only in the
 * emailed link and the requester's browser, the same reasoning as a
 * password hash. A presented token is hashed and looked up by that hash;
 * a hash with no matching row is "tampered" (any bit changed from the
 * real token) and a hash that matches a row past its expires_at, or
 * revoked, is "expired" — both are rejected with the same outward
 * behaviour (403) so a portal visitor can't distinguish "wrong token"
 * from "right token, expired" by probing.
 */

export function generatePortalToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface TokenRecord {
  requestId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type TokenValidationResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: "invalid" | "expired" | "revoked" };

/** Pure — given the record a hash lookup returned (or none), decide the outcome. */
export function validateToken(record: TokenRecord | null, now: Date): TokenValidationResult {
  if (!record) {
    return { ok: false, reason: "invalid" };
  }
  if (record.revokedAt !== null) {
    return { ok: false, reason: "revoked" };
  }
  if (new Date(record.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, requestId: record.requestId };
}

export const PORTAL_TOKEN_TTL_DAYS = 21; // Comfortably covers the 14-day default RFI due date plus slack for a late upload.

export function portalTokenExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + PORTAL_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Rate limiting (this prompt): pure sliding-window check over past attempt
 * timestamps for one token. lib/rfi/portal.ts persists attempts in
 * rfi_token_access_log and passes the recent ones in here.
 */
export const RATE_LIMIT_MAX_ATTEMPTS = 20;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes.

export function isRateLimited(recentAttemptTimestamps: readonly Date[], now: Date): boolean {
  const windowStart = now.getTime() - RATE_LIMIT_WINDOW_MS;
  const withinWindow = recentAttemptTimestamps.filter((t) => t.getTime() >= windowStart);
  return withinWindow.length >= RATE_LIMIT_MAX_ATTEMPTS;
}
