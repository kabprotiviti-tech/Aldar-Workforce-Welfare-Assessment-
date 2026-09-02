import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./*"] — tsc resolves it for
    // typechecking, but Vitest's own module resolution needs it too.
    alias: {
      "@": import.meta.dirname,
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    // tests/db/*.test.ts share one physical Postgres database and each
    // resets the whole public schema in beforeAll — running test files in
    // parallel races them against each other. The suite is small enough
    // that serial execution costs nothing worth trading correctness for.
    fileParallelism: false,
    /**
     * Scoped to the compliance rule engine, which is the one module with
     * a stated coverage requirement: "100% unit test coverage on the rule
     * functions, including boundary cases". The thresholds below make
     * that a gate rather than a claim — `npm run test:coverage` fails if
     * a new branch in a rule ever ships untested. Coverage isn't measured
     * across the rest of the codebase, where the tests that matter are
     * behavioural (RLS, the fact ledger view, the extraction pipeline)
     * rather than line-counted.
     */
    coverage: {
      provider: "v8",
      include: ["lib/rules/compliance/**/*.ts"],
      exclude: [
        "lib/rules/compliance/**/*.test.ts",
        // The Supabase adapter and the server action are "server-only"
        // I/O wiring, not logic — neither can even load in plain Vitest,
        // and the adapter is proven against real Postgres by
        // tests/db/rule-engine.test.ts. The coverage requirement is on
        // the rule functions.
        "lib/rules/compliance/**/*-supabase.ts",
        "lib/rules/compliance/actions.ts",
      ],
      reporter: ["text"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
