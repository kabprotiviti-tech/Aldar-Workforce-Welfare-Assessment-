import nextConfig from "eslint-config-next";

/**
 * "no-hardcoded-hex": bans hex color literals anywhere except the one
 * file where design tokens are defined (app/globals.css). Colors belong
 * to the token set in that file — everywhere else references them via
 * Tailwind classes / CSS var() lookups, never a literal hex value.
 *
 * ESLint's built-in parsers only cover JS/TS/JSX, not CSS, so this is a
 * plain custom rule (no plugin needed) checking string/template literals
 * for a hex-color shape. app/globals.css itself is excluded entirely via
 * this config's `ignores` below, and re-checked for stray non-token hex
 * separately by scripts/check-design-tokens.mjs (see docs/decisions.md
 * for why CSS needed a second mechanism).
 */
const HEX_COLOR_PATTERN = /#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

const noHardcodedHexRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded hex color literals outside the design token file.",
    },
    schema: [],
    messages: {
      hardcodedHex:
        "Hardcoded hex color '{{value}}' — use a design token (app/globals.css) via a Tailwind class or var(), not a literal color.",
    },
  },
  create(context) {
    function check(node, value) {
      if (typeof value === "string" && HEX_COLOR_PATTERN.test(value)) {
        context.report({ node, messageId: "hardcodedHex", data: { value } });
      }
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

const localPlugin = {
  rules: {
    "no-hardcoded-hex": noHardcodedHexRule,
  },
};

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "supabase/migrations/**",
    ],
  },
  ...nextConfig,
  {
    plugins: { local: localPlugin },
    rules: {
      "local/no-hardcoded-hex": "error",
    },
  },
];

export default config;
