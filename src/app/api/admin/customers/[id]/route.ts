import { NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
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

/**
 * DELETE /api/admin/customers/:id — verwijdert een klant volledig, inclusief
 * boekingshistorie, tegoed-batches en pakket-orders. Geweigerd zolang de klant
 * nog een actieve (pending/paid, toekomstige) boeking heeft.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const result = await withTransaction(async (client) => {
      const exists = await client.query(`SELECT 1 FROM customers WHERE id = $1`, [id]);
      if (exists.rowCount === 0) return "not_found" as const;

      const active = await client.query(
        `SELECT 1 FROM bookings
          WHERE customer_id = $1 AND status IN ('pending','paid')
            AND (end_ts IS NULL OR end_ts > now())
          LIMIT 1`,
        [id],
      );
      if ((active.rowCount ?? 0) > 0) return "has_active" as const;

      await client.query(`DELETE FROM bookings WHERE customer_id = $1`, [id]);
      await client.query(`DELETE FROM credit_batches WHERE customer_id = $1`, [id]);
      await client.query(`DELETE FROM package_orders WHERE customer_id = $1`, [id]);
      await client.query(
        `DELETE FROM login_tokens WHERE email = (SELECT lower(email) FROM customers WHERE id = $1)`,
        [id],
      );
      await client.query(`DELETE FROM customers WHERE id = $1`, [id]);
      return "deleted" as const;
    });

    if (result === "not_found") {
      return NextResponse.json({ error: "Klant niet gevonden." }, { status: 404 });
    }
    if (result === "has_active") {
      return NextResponse.json(
        { error: "Klant heeft nog een actieve of toekomstige boeking. Annuleer die eerst." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Klant ${id} verwijderen mislukt:`, err);
    return NextResponse.json({ error: "Verwijderen mislukt." }, { status: 500 });
  }
}
