import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { todayInAmsterdam } from "@/lib/availability";
import { slotLabel, type DaypartId } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/data
 * Overzicht voor het admin-scherm: aankomende boekingen + blokkades.
 */
export async function GET() {
  const today = todayInAmsterdam();

  const rows = await query<{
    id: string; booking_date: string; daypart: DaypartId | null; start_ts: string | null;
    end_ts: string | null; status: string; price_cents: number; num_people: number | null;
    paid_with_credit: boolean; notes: string | null; customer_name: string;
    customer_email: string; customer_phone: string;
  }>(
    `SELECT b.id, b.booking_date, b.daypart, b.start_ts, b.end_ts, b.status, b.price_cents,
            b.num_people, b.paid_with_credit, b.notes,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
      WHERE b.booking_date >= $1
        AND b.status IN ('paid','pending')
      ORDER BY b.booking_date ASC, b.start_ts ASC`,
    [today],
  );
  const bookings = rows.map((b) => ({ ...b, slot_label: slotLabel(b.daypart, b.start_ts, b.end_ts) }));

  const blocks = await query(
    `SELECT id, block_date, daypart, source, reason
       FROM blocks
      WHERE block_date >= $1
      ORDER BY block_date ASC`,
    [today],
  );

  return NextResponse.json({ bookings, blocks });
}
