import { NextResponse } from "next/server";
import { createTestCode } from "@/lib/nuki";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/nuki/test — maakt een testcode die 15 minuten geldig is,
 * zodat de eigenaar bij de deur kan controleren of de keypad echt opent.
 */
export async function POST() {
  const result = await createTestCode();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ pin: result.pin });
}
