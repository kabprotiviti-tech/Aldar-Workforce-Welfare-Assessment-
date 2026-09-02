import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/sign-in");
  }

  const { data: cycles } = await supabase
    .from("cycles")
    .select("id, name")
    .order("year", { ascending: false });

  return <AppShell cycles={cycles ?? []}>{children}</AppShell>;
}
