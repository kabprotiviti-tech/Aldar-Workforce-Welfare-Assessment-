import { useId } from "react";
import type { InputHTMLAttributes } from "react";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  error?: string;
}

export function Field({ label, helperText, error, id, className = "", ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-sm font-medium text-ds-ink">
        {label}
      </label>
      <input
        id={inputId}
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
