import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/admin/customers — klanten met hun actuele uren-saldo (minuten). */
export async function GET() {
  const customers = await query(
    `SELECT c.id, c.name, c.email, c.phone,
            COALESCE((
              SELECT SUM(b.minutes_remaining) FROM credit_batches b
               WHERE b.customer_id = c.id AND b.minutes_remaining > 0
                 AND (b.expires_at IS NULL OR b.expires_at > now())
            ), 0)::int AS balance_minutes
       FROM customers c
      ORDER BY c.name NULLS LAST, c.email`,
  );
  return NextResponse.json({ customers });
}
