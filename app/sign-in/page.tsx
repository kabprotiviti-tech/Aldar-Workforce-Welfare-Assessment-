import { signInWithPassword } from "@/lib/auth/actions";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <form
        action={signInWithPassword}
        className="w-full max-w-sm border border-hairline bg-surface p-6"
      >
        <h1 className="text-lg font-semibold text-ink">Sign in</h1>

        {error && <p className="mt-3 text-sm text-not-compliant">{error}</p>}

        <label className="mt-6 block text-sm text-ink-secondary">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none"
          />
        </label>

        <label className="mt-4 block text-sm text-ink-secondary">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none"
          />
        </label>

        <button
          type="submit"
          className="mt-6 w-full rounded-control bg-ink px-4 py-2 text-sm font-medium text-bg transition-colors duration-micro ease-instrument hover:opacity-90"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
