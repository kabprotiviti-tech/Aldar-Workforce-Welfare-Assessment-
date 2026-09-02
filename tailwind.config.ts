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
      },
      borderRadius: {
        control: "var(--radius)",
      },
      borderWidth: {
        hairline: "var(--hairline-width)",
      },
      boxShadow: {
        float: "var(--shadow-float)",
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
