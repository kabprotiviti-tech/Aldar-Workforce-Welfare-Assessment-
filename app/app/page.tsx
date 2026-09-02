import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Card } from "@/components/ds/card";
import { Stat } from "@/components/ds/stat";

export default async function AppHomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  const [entities, facilities, findings, assessments] = await Promise.all([
    supabase.from("entities").select("id", { count: "exact", head: true }),
    supabase.from("facilities").select("id", { count: "exact", head: true }),
    supabase.from("findings").select("id", { count: "exact", head: true }).neq("status", "closed"),
    supabase.from("assessments").select("id", { count: "exact", head: true }).is("issued_at", null),
  ]);

  return (
    <div>
      <h1 className="text-lg font-semibold text-ds-ink">Overview</h1>
      <p className="mt-1 text-sm text-ds-ink-2">Signed in as {userData.user?.email}.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <Stat label="Entities" value={entities.count ?? 0} />
        </Card>
        <Card>
          <Stat label="Facilities" value={facilities.count ?? 0} />
        </Card>
        <Card>
          <Stat label="Open findings" value={findings.count ?? 0} />
        </Card>
        <Card>
          <Stat label="Assessments in progress" value={assessments.count ?? 0} />
        </Card>
      </div>
    </div>
  );
}
