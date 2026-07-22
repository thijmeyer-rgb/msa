import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { DAYPART_BY_ID, slotLabel, formatTimeAmsterdam, type DaypartId } from "@/lib/config";

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
    daypart: DaypartId | null;
    start_ts: string | null;
    end_ts: string | null;
    price_cents: number;
    paid_with_credit: boolean;
  }>(
    `SELECT status, booking_date, daypart, start_ts, end_ts, price_cents, paid_with_credit
       FROM bookings WHERE id = $1`,
    [id],
  );

  if (!rows[0]) {
    return NextResponse.json({ error: "Boeking niet gevonden." }, { status: 404 });
  }

  const b = rows[0];
  const dp = b.daypart ? DAYPART_BY_ID[b.daypart] : null;
  return NextResponse.json({
    status: b.status,
    date: b.booking_date,
    daypart: b.daypart,
    label: dp ? dp.label : "Flexibel blok",
    start: dp ? dp.start : b.start_ts ? formatTimeAmsterdam(b.start_ts) : "",
    end: dp ? dp.end : b.end_ts ? formatTimeAmsterdam(b.end_ts) : "",
    fullLabel: slotLabel(b.daypart, b.start_ts, b.end_ts),
    priceCents: b.price_cents,
    paidWithCredit: b.paid_with_credit,
  });
}
