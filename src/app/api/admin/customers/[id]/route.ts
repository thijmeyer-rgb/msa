import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getBalanceMinutes, getActiveBatches } from "@/lib/credits";
import { slotLabel, type DaypartId } from "@/lib/config";

export const dynamic = "force-dynamic";

/** GET /api/admin/customers/:id — detail: profiel, saldo, batches, boekingen. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [profile] = await query<{ name: string; email: string; phone: string }>(
    `SELECT name, email, phone FROM customers WHERE id = $1`,
    [id],
  );
  if (!profile) return NextResponse.json({ error: "Klant niet gevonden." }, { status: 404 });

  const balanceMinutes = await getBalanceMinutes(id);
  const batches = await getActiveBatches(id);
  const bookingRows = await query<{
    id: string; booking_date: string; daypart: DaypartId | null; start_ts: string | null;
    end_ts: string | null; status: string; price_cents: number; paid_with_credit: boolean;
  }>(
    `SELECT id, booking_date, daypart, start_ts, end_ts, status, price_cents, paid_with_credit
       FROM bookings WHERE customer_id = $1
      ORDER BY booking_date DESC LIMIT 100`,
    [id],
  );
  const bookings = bookingRows.map((b) => ({ ...b, slot_label: slotLabel(b.daypart, b.start_ts, b.end_ts) }));
  const orders = await query(
    `SELECT id, package_key, minutes, price_cents, status, created_at
       FROM package_orders WHERE customer_id = $1
      ORDER BY created_at DESC LIMIT 50`,
    [id],
  );

  return NextResponse.json({ profile, balanceMinutes, batches, bookings, orders });
}
