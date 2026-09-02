import { useId } from "react";
import type { TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helperText?: string;
  error?: string;
}

export function Textarea({
  label,
  helperText,
  error,
  id,
  className = "",
  rows = 4,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const helperId = `${textareaId}-helper`;
  const errorId = `${textareaId}-error`;

  return (
    <div className={className}>
      <label htmlFor={textareaId} className="block text-sm font-medium text-ds-ink">
        {label}
      </label>
      <textarea
        id={textareaId}
        rows={rows}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        aria-invalid={error ? true : undefined}
        className={`ds-focus-ring mt-1.5 w-full rounded-ds-control border bg-ds-surface px-3 py-2 text-sm text-ds-ink placeholder:text-ds-ink-2 disabled:cursor-not-allowed disabled:bg-ds-surface-2 disabled:text-ds-ink-2 ${
          error ? "border-ds-bad" : "border-ds-line"
        }`}
        {...props}
      />
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs text-ds-bad">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="mt-1.5 text-xs text-ds-ink-2">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
