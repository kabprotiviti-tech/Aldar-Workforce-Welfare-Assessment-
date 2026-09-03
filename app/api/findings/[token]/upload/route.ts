import { NextResponse, type NextRequest } from "next/server";
import { submitPortalClosure } from "@/lib/findings/closure-portal";
import { supabaseFindingClosurePortalDb } from "@/lib/findings/closure-portal-supabase";
import { scanForVirus } from "@/lib/rfi/virus-scan";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * POST /api/findings/[token]/upload — "uploads closure evidence, adds a
 * note" (this prompt), submitted together as one closure request.
 * Mirrors app/api/rfi/[token]/upload/route.ts: the virus-scan hook runs
 * before the file is stored, and the uploader is recorded as the
 * finding's owner_contact_id (lib/findings/closure-portal-supabase.ts) —
 * never from anything the submitter sends, so it can't be spoofed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = clientIp(request);

  const formData = await request.formData();
  const note = String(formData.get("note") ?? "").trim();
  const file = formData.get("file");
  if (!note || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A note and a file are both required." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const virusScanStatus = await scanForVirus(bytes, file.name);

  const storagePath = `finding-closures/${token.slice(0, 12)}/${Date.now()}-${file.name}`;
  const admin = createSupabaseAdminClient();
  const { error: storageError } = await admin.storage.from("evidence").upload(storagePath, bytes, {
    contentType: file.type || "application/octet-stream",
  });
  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const result = await submitPortalClosure(supabaseFindingClosurePortalDb(), token, ip, new Date(), {
    note,
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
