import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-ds-card border border-ds-line bg-ds-surface p-4 shadow-ds-1 ${className}`}
      {...props}
    />
  );
}
