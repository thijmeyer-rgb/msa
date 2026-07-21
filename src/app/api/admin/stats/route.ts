import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats — kerncijfers voor het dashboard.
 * Omzet = daadwerkelijk ontvangen geld: betaalde (niet-tegoed) boekingen +
 * betaalde pakket-aankopen. Tegoed-boekingen tellen niet mee (het geld is al
 * geteld bij de pakketaankoop).
 */
export async function GET() {
  // Omzet per periode (in centen).
  const [revenue] = await query<{ week: number; month: number; total: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at >= now() - interval '7 days'  THEN amount END),0)::int AS week,
       COALESCE(SUM(CASE WHEN created_at >= now() - interval '30 days' THEN amount END),0)::int AS month,
       COALESCE(SUM(amount),0)::int AS total
     FROM (
       SELECT (price_cents - discount_cents) AS amount, created_at FROM bookings
         WHERE status='paid' AND paid_with_credit=false
       UNION ALL
       SELECT price_cents AS amount, created_at FROM package_orders WHERE status='paid'
     ) r`,

  );

  const [upcoming] = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bookings WHERE status='paid' AND booking_date >= current_date`,
  );

  // Bezettingsgraad laatste 30 dagen: verkochte dagdelen / (4 per dag * 30).
  const [occ] = await query<{ booked: number }>(
    `SELECT count(*)::int AS booked FROM bookings
       WHERE status='paid' AND booking_date >= current_date - 30 AND booking_date < current_date`,
  );
  const occupancy = Math.round((occ.booked / (4 * 30)) * 100);

  const [avg] = await query<{ avg: number }>(
    `SELECT COALESCE(AVG(price_cents),0)::int AS avg FROM bookings
       WHERE status='paid' AND paid_with_credit=false`,
  );

  const byDaypart = await query<{ daypart: string; n: number }>(
    `SELECT daypart, count(*)::int AS n FROM bookings WHERE status='paid' GROUP BY daypart`,
  );

  const byWeekday = await query<{ dow: number; n: number }>(
    `SELECT EXTRACT(DOW FROM booking_date)::int AS dow, count(*)::int AS n
       FROM bookings WHERE status='paid' GROUP BY EXTRACT(DOW FROM booking_date)`,
  );

  const [cust] = await query<{ nieuw: number; terugkerend: number }>(
    `SELECT
       count(*) FILTER (WHERE c = 1)::int AS nieuw,
       count(*) FILTER (WHERE c > 1)::int AS terugkerend
     FROM (SELECT customer_id, count(*) AS c FROM bookings WHERE status='paid' GROUP BY customer_id) t`,
  );

  const [credit] = await query<{ minutes: number }>(
    `SELECT COALESCE(SUM(minutes_remaining),0)::int AS minutes FROM credit_batches
       WHERE minutes_remaining > 0 AND (expires_at IS NULL OR expires_at > now())`,
  );

  const [conv] = await query<{ paid: number; lost: number }>(
    `SELECT
       count(*) FILTER (WHERE status='paid')::int AS paid,
       count(*) FILTER (WHERE status IN ('expired','canceled','failed'))::int AS lost
     FROM bookings WHERE created_at >= now() - interval '30 days'`,
  );

  const totalConv = conv.paid + conv.lost;
  const conversion = totalConv > 0 ? Math.round((conv.paid / totalConv) * 100) : 0;

  return NextResponse.json({
    revenue,
    upcoming: upcoming.n,
    occupancy,
    avgBookingCents: avg.avg,
    byDaypart,
    byWeekday,
    customers: cust,
    outstandingCreditMinutes: credit.minutes,
    conversion,
  });
}
