import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getBalanceMinutes, getActiveBatches } from "@/lib/credits";

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
  const bookings = await query(
    `SELECT id, booking_date, daypart, status, price_cents, paid_with_credit
       FROM bookings WHERE customer_id = $1
      ORDER BY booking_date DESC LIMIT 100`,
    [id],
  );
  const orders = await query(
    `SELECT id, package_key, minutes, price_cents, status, created_at
       FROM package_orders WHERE customer_id = $1
      ORDER BY created_at DESC LIMIT 50`,
    [id],
  );

  return NextResponse.json({ profile, balanceMinutes, batches, bookings, orders });
}
