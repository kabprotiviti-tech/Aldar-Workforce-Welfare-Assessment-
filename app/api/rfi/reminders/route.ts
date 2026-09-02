import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { sendDueReminders } from "@/lib/rfi/send-reminders";

/**
 * Triggered daily by Vercel Cron (vercel.json) via a GET request carrying
 * "Authorization: Bearer <CRON_SECRET>" — Vercel adds that header
 * automatically for a project env var named CRON_SECRET. Fails closed:
 * with no CRON_SECRET configured, every request is rejected rather than
 * the reminder schedule running unauthenticated.
 */
export async function GET(request: NextRequest) {
  const provided = request.headers.get("authorization");
  if (!serverEnv.CRON_SECRET || provided !== `Bearer ${serverEnv.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendDueReminders();
  return NextResponse.json(result);
}
