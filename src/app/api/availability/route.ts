import { NextResponse } from "next/server";
import { getAvailabilityForDate, isDateWithinWindow } from "@/lib/availability";

export const dynamic = "force-dynamic"; // altijd verse beschikbaarheid

/**
 * GET /api/availability?date=YYYY-MM-DD
 * Geeft de beschikbaarheid van alle dagdelen op de gevraagde datum.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Ongeldige of ontbrekende datum." }, { status: 400 });
  }
  if (!isDateWithinWindow(date)) {
    return NextResponse.json({ error: "Datum valt buiten het boekingsvenster." }, { status: 400 });
  }

  const slots = await getAvailabilityForDate(date);
  return NextResponse.json({ date, slots });
}
