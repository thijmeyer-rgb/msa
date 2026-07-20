import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  createBookingWithCredits,
  SlotTakenError,
  SlotNotBookableError,
} from "@/lib/bookings";
import { InsufficientCreditsError } from "@/lib/credits";
import { isDaypartId } from "@/lib/config";

const Schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daypart: z.string().refine(isDaypartId, "Ongeldig dagdeel."),
  numPeople: z.coerce.number().int().min(1).max(20).optional(),
});

/**
 * POST /api/bookings/credit — boekt een dagdeel met uren-tegoed (geen betaling).
 * Vereist een ingelogde klant met voldoende saldo.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log eerst in." }, { status: 401 });

  let data: z.infer<typeof Schema>;
  try {
    data = Schema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors[0]?.message : "Ongeldige invoer.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const result = await createBookingWithCredits({
      customerId: session.customerId,
      date: data.date,
      daypart: data.daypart as never,
      numPeople: data.numPeople,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientCreditsError)
      return NextResponse.json({ error: err.message, code: "insufficient_credits" }, { status: 409 });
    if (err instanceof SlotTakenError)
      return NextResponse.json({ error: err.message, code: "slot_taken" }, { status: 409 });
    if (err instanceof SlotNotBookableError)
      return NextResponse.json({ error: err.message, code: "not_bookable" }, { status: 409 });
    console.error("Boeking met tegoed mislukt:", err);
    return NextResponse.json({ error: "Er ging iets mis." }, { status: 500 });
  }
}
