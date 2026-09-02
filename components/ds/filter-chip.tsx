import type { ButtonHTMLAttributes } from "react";

export interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** A toggleable filter, e.g. "Key requirements only". */
export function FilterChip({ selected = false, className = "", ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`ds-focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-150 ${
        selected
          ? "border-ds-accent bg-ds-accent-soft text-ds-accent-2"
          : "border-ds-line bg-ds-surface text-ds-ink-2 hover:border-ds-accent hover:text-ds-ink"
      } ${className}`}
      {...props}
    />
  );
}
