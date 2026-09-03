import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { sendDueEscalations } from "@/lib/findings/send-escalations";

/**
 * Triggered daily by Vercel Cron (vercel.json), the same
 * CRON_SECRET-gated shape as app/api/rfi/reminders/route.ts. Fails
 * closed: with no CRON_SECRET configured, every request is rejected
 * rather than the escalation schedule running unauthenticated.
 */
export async function GET(request: NextRequest) {
  const provided = request.headers.get("authorization");
  if (!serverEnv.CRON_SECRET || provided !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendDueEscalations();
  return NextResponse.json(result);
}
