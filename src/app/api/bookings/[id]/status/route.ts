import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { DAYPART_BY_ID, type DaypartId } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/bookings/:id/status
 * Publiek: geeft alleen de status en de kern-gegevens van een boeking terug
 * (geen persoonsgegevens). Gebruikt door de statuspagina om te pollen.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Ongeldig boekings-id." }, { status: 400 });
  }

  const rows = await query<{
    status: string;
    booking_date: string;
    daypart: DaypartId;
    price_cents: number;
  }>(`SELECT status, booking_date, daypart, price_cents FROM bookings WHERE id = $1`, [id]);

  if (!rows[0]) {
    return NextResponse.json({ error: "Boeking niet gevonden." }, { status: 404 });
  }

  const b = rows[0];
  const dp = DAYPART_BY_ID[b.daypart];
  return NextResponse.json({
    status: b.status,
    date: b.booking_date,
    daypart: b.daypart,
    label: dp.label,
    start: dp.start,
    end: dp.end,
    priceCents: b.price_cents,
  });
}
