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
  },
});
