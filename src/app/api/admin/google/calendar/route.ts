import { NextResponse } from "next/server";
import { setCalendarId } from "@/lib/gcal";

export const dynamic = "force-dynamic";

/** POST /api/admin/google/calendar — kies in welke agenda boekingen komen. */
export async function POST(request: Request) {
  let calendarId = "";
  try {
    calendarId = String(((await request.json()) as { calendarId?: unknown }).calendarId ?? "");
  } catch {
    /* leeg → primary */
  }
  await setCalendarId(calendarId);
  return NextResponse.json({ ok: true });
}
