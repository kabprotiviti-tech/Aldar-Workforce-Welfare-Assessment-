import { NextResponse, type NextRequest } from "next/server";
import { submitPortalUpload } from "@/lib/rfi/portal";
import { supabaseRfiPortalDb } from "@/lib/rfi/portal-supabase";
import { scanForVirus } from "@/lib/rfi/virus-scan";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * POST /api/rfi/[token]/upload — upload against one checklist line. The
 * acceptance criterion this satisfies: "uploading against a checklist
 * line creates an evidence_files row linked to the assessment and the
 * requirement, with the uploader recorded as the entity contact"
 * (lib/rfi/portal.ts's recordUpload — the contact comes from the RFI
 * request itself, never from anything the uploader submits, so it can't
 * be spoofed). Runs the virus-scan hook (lib/rfi/virus-scan.ts — stub
 * today, swappable) before the file is stored.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = clientIp(request);

  const formData = await request.formData();
  const checklistItemId = String(formData.get("checklist_item_id") ?? "");
  const file = formData.get("file");
  if (!checklistItemId || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "checklist_item_id and a file are required." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const virusScanStatus = await scanForVirus(bytes, file.name);

  const storagePath = `rfi-uploads/${checklistItemId}/${Date.now()}-${file.name}`;
  const admin = createSupabaseAdminClient();
  const { error: storageError } = await admin.storage.from("evidence").upload(storagePath, bytes, {
    contentType: file.type || "application/octet-stream",
  });
  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const result = await submitPortalUpload(supabaseRfiPortalDb(), token, ip, new Date(), {
    checklistItemId,
    storagePath,
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    virusScanStatus,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }
  return NextResponse.json({ evidenceFileId: result.evidenceFileId });
}
