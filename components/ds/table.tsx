import type { TdHTMLAttributes, ThHTMLAttributes, HTMLAttributes } from "react";

export function Table({ className = "", ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-ds-card border border-ds-line">
      <table className={`w-full min-w-[480px] border-collapse text-left text-sm ${className}`} {...props} />
    </div>
  );
}

export function TableHead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={`bg-ds-surface-2 ${className}`} {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={`border-t border-ds-line ${className}`} {...props} />;
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function TableHeaderCell({ numeric = false, className = "", ...props }: TableHeaderCellProps) {
  return (
    <th
      className={`px-4 py-2.5 text-xs font-medium text-ds-ink-2 ${numeric ? "text-right" : "text-left"} ${className}`}
      {...props}
    />
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function TableCell({ numeric = false, className = "", ...props }: TableCellProps) {
  return (
    <td
      className={`px-4 py-3 text-ds-ink ${numeric ? "text-right tabular-nums" : "text-left"} ${className}`}
      {...props}
    />
  );
}
