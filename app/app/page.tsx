import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppHomePage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-ink-secondary">Signed in as {data.user?.email}.</p>
    </div>
  );
}
