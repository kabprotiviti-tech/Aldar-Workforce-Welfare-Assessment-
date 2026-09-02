import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        "ink-secondary": "var(--ink-secondary)",
        hairline: "var(--hairline)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        compliant: "var(--compliant)",
        partial: "var(--partial)",
        "not-compliant": "var(--not-compliant)",
        "not-applicable": "var(--not-applicable)",
        overlay: "var(--overlay)",

        // Product design system ("ds-" namespace) — see docs/decisions.md
        // for why this coexists with the marketing tokens above instead
        // of replacing them.
        "ds-bg": "var(--ds-bg)",
        "ds-surface": "var(--ds-surface)",
        "ds-surface-2": "var(--ds-surface-2)",
        "ds-ink": "var(--ds-ink)",
        "ds-ink-2": "var(--ds-ink-2)",
        "ds-ink-3": "var(--ds-ink-3)",
        "ds-line": "var(--ds-line)",
        "ds-accent": "var(--ds-accent)",
        "ds-accent-2": "var(--ds-accent-2)",
        "ds-accent-soft": "var(--ds-accent-soft)",
        "ds-ok": "var(--ds-ok)",
        "ds-warn": "var(--ds-warn)",
        "ds-bad": "var(--ds-bad)",
        "ds-info": "var(--ds-info)",
      },
      borderRadius: {
        control: "var(--radius)",
        "ds-card": "var(--ds-radius-card)",
        "ds-control": "var(--ds-radius-control)",
      },
      borderWidth: {
        hairline: "var(--hairline-width)",
      },
      boxShadow: {
        float: "var(--shadow-float)",
        "ds-1": "var(--ds-shadow-1)",
        "ds-2": "var(--ds-shadow-2)",
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "Helvetica Neue", "Arial", "sans-serif"],
        numeral: ["var(--font-plex-serif)", "Georgia", "serif"],
      },
      transitionDuration: {
        micro: "var(--dur-micro)",
        structural: "var(--dur-structural)",
      },
      transitionTimingFunction: {
        instrument: "var(--ease)",
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        6: "var(--space-6)",
        8: "var(--space-8)",
        12: "var(--space-12)",
        16: "var(--space-16)",
        24: "var(--space-24)",
      },
    },
  },
  plugins: [],
};

export default config;
