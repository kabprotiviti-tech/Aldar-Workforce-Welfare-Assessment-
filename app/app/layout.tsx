import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/auth/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/sign-in");
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-hairline bg-surface px-6 py-3">
        <span className="text-sm font-semibold text-ink">WWAP</span>
        <form action={signOut}>
          <button type="submit" className="text-sm text-ink-secondary hover:text-ink">
            Sign out
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
