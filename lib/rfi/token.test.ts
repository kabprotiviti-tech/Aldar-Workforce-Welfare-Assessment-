import { describe, expect, it } from "vitest";
import {
  generatePortalToken,
  hashPortalToken,
  isRateLimited,
  portalTokenExpiry,
  validateToken,
  RATE_LIMIT_MAX_ATTEMPTS,
} from "./token";

describe("generatePortalToken / hashPortalToken", () => {
  it("generates a different token every time", () => {
    expect(generatePortalToken()).not.toBe(generatePortalToken());
  });

  it("hashes the same token to the same value, deterministically", () => {
    const token = generatePortalToken();
    expect(hashPortalToken(token)).toBe(hashPortalToken(token));
  });

  it("hashes different tokens to different values", () => {
    expect(hashPortalToken("token-a")).not.toBe(hashPortalToken("token-b"));
  });

  it("a single flipped character produces a completely different hash (tamper-evident)", () => {
    const token = "a".repeat(43);
    const tampered = `b${token.slice(1)}`;
    expect(hashPortalToken(token)).not.toBe(hashPortalToken(tampered));
  });
});

describe("validateToken", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("rejects a hash with no matching record as invalid (tampered/unknown)", () => {
    expect(validateToken(null, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired token", () => {
    const result = validateToken(
      { requestId: "req-1", expiresAt: "2026-06-14T00:00:00Z", revokedAt: null },
      now,
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token at the exact moment it expires", () => {
    const result = validateToken(
      { requestId: "req-1", expiresAt: "2026-06-15T00:00:00Z", revokedAt: null },
      now,
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a revoked token even if not yet expired", () => {
    const result = validateToken(
      { requestId: "req-1", expiresAt: "2026-06-20T00:00:00Z", revokedAt: "2026-06-14T00:00:00Z" },
      now,
    );
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  it("accepts a token that is neither expired nor revoked", () => {
    const result = validateToken(
      { requestId: "req-1", expiresAt: "2026-06-20T00:00:00Z", revokedAt: null },
      now,
    );
    expect(result).toEqual({ ok: true, requestId: "req-1" });
  });
});

describe("portalTokenExpiry", () => {
  it("expires 21 days after issue", () => {
    const issuedAt = new Date("2026-06-01T00:00:00Z");
    expect(portalTokenExpiry(issuedAt).toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });
});

describe("isRateLimited", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("allows a token under the limit", () => {
    const attempts = Array.from({ length: RATE_LIMIT_MAX_ATTEMPTS - 1 }, () => now);
    expect(isRateLimited(attempts, now)).toBe(false);
  });

  it("blocks a token at or over the limit within the window", () => {
    const attempts = Array.from({ length: RATE_LIMIT_MAX_ATTEMPTS }, () => now);
    expect(isRateLimited(attempts, now)).toBe(true);
  });

  it("ignores attempts outside the window", () => {
    const longAgo = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago, outside a 10-minute window.
    const attempts = Array.from({ length: RATE_LIMIT_MAX_ATTEMPTS + 5 }, () => longAgo);
    expect(isRateLimited(attempts, now)).toBe(false);
  });
});
