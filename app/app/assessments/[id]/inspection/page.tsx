import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AreaInspection, type InspectionArea } from "@/components/inspection/area-inspection";
import type { ComplianceRating } from "@/lib/rules/constants";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * The on-site inspection page. Everything it needs is loaded here, once,
 * before the assessor loses signal — the areas, their questions and their
 * current ratings. From that point the screen is a local application
 * writing to IndexedDB, and the network only matters to the sync bar.
 */
export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, subject_code, module, entities(name), facilities(name)")
    .eq("id", id)
    .maybeSingle();
  if (!assessment) {
    notFound();
  }

  const facilityName =
    oneOf(assessment.facilities as unknown as { name: string } | { name: string }[] | null)?.name ??
    oneOf(assessment.entities as unknown as { name: string } | { name: string }[] | null)?.name ??
    "";

  const { data: itemRows } = await supabase
    .from("assessment_items")
    .select("id, requirement_id, compliance_status, requirements(sl_no, title)")
    .eq("assessment_id", id);

  const requirementIds = (itemRows ?? []).map((row) => row.requirement_id as string);
  const { data: questionRows } = requirementIds.length
    ? await supabase.from("questions").select("id, requirement_id, text").in("requirement_id", requirementIds).is("deleted_at", null).order("code")
    : { data: [] as { id: string; requirement_id: string; text: string }[] };

  const questionsByRequirement = new Map<string, { id: string; text: string }[]>();
  for (const row of questionRows ?? []) {
    const list = questionsByRequirement.get(row.requirement_id as string) ?? [];
    list.push({ id: row.id as string, text: row.text as string });
    questionsByRequirement.set(row.requirement_id as string, list);
  }

  const areas: InspectionArea[] = (itemRows ?? [])
    .map((row) => {
      const requirement = oneOf(row.requirements as unknown as { sl_no: number; title: string } | null);
      return requirement
        ? {
            assessmentItemId: row.id as string,
            requirementId: row.requirement_id as string,
            slNo: requirement.sl_no,
            title: requirement.title,
            questions: questionsByRequirement.get(row.requirement_id as string) ?? [],
            status: (row.compliance_status as ComplianceRating | null) ?? null,
          }
        : null;
    })
    .filter((entry): entry is InspectionArea => entry !== null)
    .sort((a, b) => a.slNo - b.slNo);

  return <AreaInspection assessmentId={id} facilityName={facilityName} subjectCode={assessment.subject_code} areas={areas} />;
}
