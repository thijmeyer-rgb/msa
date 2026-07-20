import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { todayInAmsterdam } from "@/lib/availability";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/data
 * Overzicht voor het admin-scherm: aankomende boekingen + blokkades.
 */
export async function GET() {
  const today = todayInAmsterdam();

  const bookings = await query(
    `SELECT b.id, b.booking_date, b.daypart, b.status, b.price_cents,
            b.num_people, b.paid_with_credit, b.notes,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
      WHERE b.booking_date >= $1
        AND b.status IN ('paid','pending')
      ORDER BY b.booking_date ASC, b.daypart ASC`,
    [today],
  );

  const blocks = await query(
    `SELECT id, block_date, daypart, source, reason
       FROM blocks
      WHERE block_date >= $1
      ORDER BY block_date ASC`,
    [today],
  );

  return NextResponse.json({ bookings, blocks });
}
