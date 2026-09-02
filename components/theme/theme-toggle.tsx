"use client";

import { useTheme } from "@/components/theme/theme-provider";
import { THEME_LABELS, THEMES, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = THEMES[(index + delta + THEMES.length) % THEMES.length] as Theme;
    setTheme(next);
    (document.getElementById(`theme-option-${next}`) as HTMLButtonElement | null)?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="flex border border-hairline">
      {THEMES.map((option, index) => {
        const active = option === theme;
        return (
          <button
            key={option}
            id={`theme-option-${option}`}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => setTheme(option)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={[
              "px-3 py-1.5 text-sm transition-colors duration-micro ease-instrument",
              index > 0 ? "border-l border-hairline" : "",
              active ? "bg-ink text-bg" : "text-ink-secondary hover:text-ink",
            ].join(" ")}
          >
            {THEME_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
