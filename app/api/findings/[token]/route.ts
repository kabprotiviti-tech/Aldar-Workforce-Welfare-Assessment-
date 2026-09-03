import { NextResponse, type NextRequest } from "next/server";
import { getPortalFinding } from "@/lib/findings/closure-portal";
import { supabaseFindingClosurePortalDb } from "@/lib/findings/closure-portal-supabase";

function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * GET /api/findings/[token] — the closure portal's read, mirroring
 * app/api/rfi/[token]/route.ts: no account, no Supabase session —
 * checkClosurePortalAccess (lib/findings/closure-portal.ts) is the
 * entire access boundary, backed by rate limiting + a hashed-token
 * lookup, not RLS.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getPortalFinding(supabaseFindingClosurePortalDb(), token, clientIp(request), new Date());

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }
  return NextResponse.json({ finding: result.finding });
}
