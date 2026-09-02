"use client";

export interface RadioOption {
  value: string;
  label: string;
}

export interface RadioGroupProps {
  name: string;
  label: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** Single-select, rendered as pill options rather than native radio dots. */
export function RadioGroup({ name, label, options, value, onChange, className = "" }: RadioGroupProps) {
  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = options[(index + delta + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    document.getElementById(`${name}-${next.value}`)?.focus();
  }

  return (
    <div className={className}>
      <span id={`${name}-label`} className="block text-sm font-medium text-ds-ink">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`${name}-label`} className="mt-1.5 flex flex-wrap gap-2">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              id={`${name}-${option.value}`}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`ds-focus-ring rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                selected
                  ? "border-ds-accent bg-ds-accent text-white"
                  : "border-ds-line bg-ds-surface text-ds-ink-2 hover:border-ds-accent hover:text-ds-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
