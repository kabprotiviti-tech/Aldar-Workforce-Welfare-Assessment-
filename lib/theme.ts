export const THEMES = ["paper", "slate", "ink", "high-contrast"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  paper: "Paper",
  slate: "Slate",
  ink: "Ink",
  "high-contrast": "High contrast",
};

export const THEME_STORAGE_KEY = "wwap-theme";

export function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}
