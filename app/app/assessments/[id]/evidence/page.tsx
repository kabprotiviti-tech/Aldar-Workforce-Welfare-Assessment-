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
  const [{ data: links }, { data: extractions }, { data: facts }] = await Promise.all([
    fileIds.length > 0
      ? supabase.from("evidence_file_requirements").select("evidence_file_id, requirement_id").in("evidence_file_id", fileIds)
      : Promise.resolve({ data: [] as { evidence_file_id: string; requirement_id: string }[] }),
    fileIds.length > 0
      ? supabase.from("extractions").select("evidence_file_id, cost_usd, error, created_at").in("evidence_file_id", fileIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { evidence_file_id: string; cost_usd: number | null; error: string | null; created_at: string }[] }),
    fileIds.length > 0
      ? supabase.from("extracted_facts").select("evidence_file_id").in("evidence_file_id", fileIds)
      : Promise.resolve({ data: [] as { evidence_file_id: string }[] }),
  ]);

  // extractions is ordered newest-first, so the first row seen per file is its latest attempt.
  const latestExtractionByFile = new Map<string, { costUsd: number | null; error: string | null }>();
  for (const e of extractions ?? []) {
    if (!latestExtractionByFile.has(e.evidence_file_id)) {
      latestExtractionByFile.set(e.evidence_file_id, { costUsd: e.cost_usd, error: e.error });
    }
  }
  const factCountByFile = new Map<string, number>();
  for (const f of facts ?? []) {
    factCountByFile.set(f.evidence_file_id, (factCountByFile.get(f.evidence_file_id) ?? 0) + 1);
  }

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
      extractions={fileIds.map((fileId) => ({
        evidenceFileId: fileId,
        costUsd: latestExtractionByFile.get(fileId)?.costUsd ?? null,
        error: latestExtractionByFile.get(fileId)?.error ?? null,
        factCount: factCountByFile.get(fileId) ?? 0,
      }))}
    />
  );
}
