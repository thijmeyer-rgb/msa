import { NextResponse } from "next/server";
import { disconnect } from "@/lib/gcal";

export const dynamic = "force-dynamic";

/** POST /api/admin/google/disconnect — ontkoppelt de Google-agenda. */
export async function POST() {
  await disconnect();
  return NextResponse.json({ ok: true });
}
