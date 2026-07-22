import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { getBalanceMinutes, getActiveBatches } from "@/lib/credits";
import { slotLabel, type DaypartId } from "@/lib/config";

export const dynamic = "force-dynamic";

/** GET /api/account/me — profiel, saldo, batches en boekingen van de ingelogde klant. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const [profile] = await query<{ name: string; email: string; phone: string }>(
    `SELECT name, email, phone FROM customers WHERE id = $1`,
    [session.customerId],
  );
  const balanceMinutes = await getBalanceMinutes(session.customerId);
  const batches = await getActiveBatches(session.customerId);
  const bookingRows = await query<{
    id: string; booking_date: string; daypart: DaypartId | null; start_ts: string | null;
    end_ts: string | null; status: string; price_cents: number; paid_with_credit: boolean;
  }>(
    `SELECT id, booking_date, daypart, start_ts, end_ts, status, price_cents, paid_with_credit
       FROM bookings
      WHERE customer_id = $1 AND status IN ('paid','pending')
      ORDER BY booking_date DESC LIMIT 50`,
    [session.customerId],
  );
  const bookings = bookingRows.map((b) => ({ ...b, slot_label: slotLabel(b.daypart, b.start_ts, b.end_ts) }));

  return NextResponse.json({
    profile: profile ?? { name: "", email: session.email, phone: "" },
    balanceMinutes,
    batches,
    bookings,
  });
}
