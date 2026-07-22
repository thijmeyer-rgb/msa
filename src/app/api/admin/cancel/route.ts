import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { refundBookingCreditsIfAny, removeCalendarEventIfAny } from "@/lib/bookings";

const CancelSchema = z.object({ bookingId: z.string().uuid() });

/**
 * POST /api/admin/cancel — annuleert een boeking en geeft het slot vrij.
 * (Terugbetaling via Mollie doe je handmatig; dit zet alleen de status.)
 */
export async function POST(request: Request) {
  let data: z.infer<typeof CancelSchema>;
  try {
    data = CancelSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Ongeldig id." }, { status: 400 });
  }

  const rows = await query<{ id: string }>(
    `UPDATE bookings SET status = 'canceled', expires_at = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('paid','pending')
      RETURNING id`,
    [data.bookingId],
  );

  if (!rows[0]) {
    return NextResponse.json({ error: "Boeking niet gevonden of al afgerond." }, { status: 404 });
  }
  // Was dit een boeking met uren-tegoed? Geef de uren dan terug.
  await refundBookingCreditsIfAny(data.bookingId);
  // Haal (indien gekoppeld) de afspraak uit de Google-agenda.
  await removeCalendarEventIfAny(data.bookingId);
  return NextResponse.json({ ok: true });
}
