import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EvidenceLibrary } from "@/components/evidence/evidence-library";

function oneOf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function AssessmentEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, subject_code, template_id, entities(name), facilities(name)")
    .eq("id", id)
    .maybeSingle();
  if (!assessment) {
    notFound();
  }

  const entityName =
    oneOf(assessment.facilities as unknown as { name: string } | { name: string }[] | null)?.name ??
    oneOf(assessment.entities as unknown as { name: string } | { name: string }[] | null)?.name ??
    "";

  const [{ data: requirements }, { data: files }] = await Promise.all([
    supabase
      .from("requirements")
      .select("id, sl_no, title")
      .eq("template_id", assessment.template_id)
      .is("deleted_at", null)
      .order("sl_no"),
    supabase
      .from("evidence_files")
      .select("id, storage_path, original_name, mime_type, size_bytes, document_class, review_status, uploaded_at")
      .eq("assessment_id", id)
      .order("uploaded_at", { ascending: false }),
  ]);

  const fileIds = (files ?? []).map((f) => f.id);
  const { data: links } =
    fileIds.length > 0
      ? await supabase.from("evidence_file_requirements").select("evidence_file_id, requirement_id").in("evidence_file_id", fileIds)
      : { data: [] as { evidence_file_id: string; requirement_id: string }[] };

  return (
    <EvidenceLibrary
      assessmentId={id}
      subjectCode={assessment.subject_code}
      entityName={entityName}
      requirements={(requirements ?? []).map((r) => ({ id: r.id, slNo: r.sl_no, title: r.title }))}
      files={(files ?? []).map((f) => ({
        id: f.id,
        storagePath: f.storage_path,
        originalName: f.original_name,
        mimeType: f.mime_type,
        sizeBytes: f.size_bytes,
        documentClass: f.document_class,
        reviewStatus: f.review_status,
        uploadedAt: f.uploaded_at,
      }))}
      links={(links ?? []).map((l) => ({ evidenceFileId: l.evidence_file_id, requirementId: l.requirement_id }))}
    />
  );
}
