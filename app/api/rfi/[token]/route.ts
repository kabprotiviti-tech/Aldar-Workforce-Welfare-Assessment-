import { NextResponse, type NextRequest } from "next/server";
import { getPortalChecklist } from "@/lib/rfi/portal";
import { supabaseRfiPortalDb } from "@/lib/rfi/portal-supabase";

function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * GET /api/rfi/[token] — the portal's checklist read, and the surface this
 * prompt's acceptance criterion is actually about: "an expired or
 * tampered token returns 403 and is logged." No account, no Supabase
 * session — checkPortalAccess (lib/rfi/portal.ts) is the entire access
 * boundary, backed by rate limiting + a hashed-token lookup, not RLS.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getPortalChecklist(supabaseRfiPortalDb(), token, clientIp(request), new Date());

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }
  return NextResponse.json({ checklist: result.checklist });
}
