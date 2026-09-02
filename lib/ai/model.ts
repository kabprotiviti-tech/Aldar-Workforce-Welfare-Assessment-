/**
 * Model identity/limits as plain constants — no "server-only", no env
 * access — so lib/ai/extract.ts (and its tests) and lib/ai/client.ts can
 * both depend on them without either pulling in the other's runtime
 * requirements.
 */
export const EXTRACTION_MODEL = "claude-sonnet-4-6";

/** Hard per-request token ceiling (this prompt). */
export const MAX_OUTPUT_TOKENS = 4096;
