import type { HTMLAttributes } from "react";

export type PillTone = "neutral" | "ok" | "warn" | "bad" | "info";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

/** Status badge. Tone maps to a semantic state (ok/warn/bad/info), not a decoration. */
export function Pill({ tone = "neutral", className = "", ...props }: PillProps) {
  return (
    <span
      className={`ds-pill-${tone} inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}
      {...props}
    />
  );
}
