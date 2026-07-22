import { NextResponse } from "next/server";
import { getGcalStatus, listCalendars } from "@/lib/gcal";

export const dynamic = "force-dynamic";

/** GET /api/admin/google/status — koppelingsstatus + beschikbare agenda's. */
export async function GET() {
  const status = await getGcalStatus();
  const calendars = status.connected ? await listCalendars() : [];
  return NextResponse.json({ ...status, calendars });
}
