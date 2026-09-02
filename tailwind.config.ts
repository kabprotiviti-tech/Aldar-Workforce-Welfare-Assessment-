import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#F6F5F2",
        ink: "#16222E",
        accent: "#16736C",
        border: "#E2E0DA",
        compliant: "#2C6E58",
        partial: "#95661A",
        "non-compliant": "#9E3B33",
        na: "#8A8A85",
      },
      fontFeatureSettings: {
        tabular: '"tnum"',
      },
    },
  },
  plugins: [],
};

export default config;
