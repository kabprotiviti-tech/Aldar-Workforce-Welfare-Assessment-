import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-ds-card border border-dashed border-ds-line bg-ds-surface-2 px-6 py-12 text-center ${className}`}
    >
      <p className="text-sm font-medium text-ds-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ds-ink-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
