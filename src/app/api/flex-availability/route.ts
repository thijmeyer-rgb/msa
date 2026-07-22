import { NextResponse } from "next/server";
import { getFlexAvailability } from "@/lib/availability";

export const dynamic = "force-dynamic";

/** GET /api/flex-availability?date=YYYY-MM-DD — vrije starttijden voor een 2u-flexblok. */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Ongeldige datum." }, { status: 400 });
  }
  const slots = await getFlexAvailability(date);
  return NextResponse.json({ date, slots });
}
