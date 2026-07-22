import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createFlexBookingWithCredits, SlotTakenError, SlotNotBookableError } from "@/lib/bookings";
import { InsufficientCreditsError } from "@/lib/credits";

const Schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
});

/**
 * POST /api/bookings/flex — boekt een flexibel blok van 2 uur met uren-tegoed.
 * Alleen voor ingelogde abonnees met voldoende saldo (120 min).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log eerst in." }, { status: 401 });

  let data: z.infer<typeof Schema>;
  try {
    data = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400 });
  }

  try {
    const result = await createFlexBookingWithCredits({
      customerId: session.customerId,
      date: data.date,
      startTime: data.startTime,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientCreditsError)
      return NextResponse.json({ error: err.message, code: "insufficient_credits" }, { status: 409 });
    if (err instanceof SlotTakenError)
      return NextResponse.json({ error: "Deze tijd is zojuist bezet geraakt.", code: "slot_taken" }, { status: 409 });
    if (err instanceof SlotNotBookableError)
      return NextResponse.json({ error: err.message, code: "not_bookable" }, { status: 409 });
    console.error("Flex-boeking mislukt:", err);
    return NextResponse.json({ error: "Er ging iets mis." }, { status: 500 });
  }
}
