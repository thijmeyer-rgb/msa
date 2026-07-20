import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createBookingAndPayment,
  SlotTakenError,
  SlotNotBookableError,
} from "@/lib/bookings";
import { isDaypartId } from "@/lib/config";

const BookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ongeldige datum."),
  daypart: z.string().refine(isDaypartId, "Ongeldig dagdeel."),
  name: z.string().trim().min(2, "Vul je naam in.").max(120),
  email: z.string().trim().email("Ongeldig e-mailadres.").max(200),
  phone: z.string().trim().min(6, "Vul je telefoonnummer in.").max(40),
  numPeople: z.coerce.number().int().min(1).max(20).optional(),
});

/**
 * POST /api/bookings
 * Body: { date, daypart, name, email, phone, numPeople? }
 * Reserveert het slot (pending) en start de Mollie-betaling.
 * Antwoord: { bookingId, checkoutUrl } — frontend stuurt door naar Mollie.
 */
export async function POST(request: Request) {
  let data: z.infer<typeof BookingSchema>;
  try {
    const body = await request.json();
    data = BookingSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? "Ongeldige invoer." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  try {
    const result = await createBookingAndPayment({
      date: data.date,
      daypart: data.daypart as never,
      name: data.name,
      email: data.email,
      phone: data.phone,
      numPeople: data.numPeople,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof SlotTakenError) {
      return NextResponse.json({ error: err.message, code: "slot_taken" }, { status: 409 });
    }
    if (err instanceof SlotNotBookableError) {
      return NextResponse.json({ error: err.message, code: "not_bookable" }, { status: 409 });
    }
    console.error("Boeking aanmaken mislukt:", err);
    return NextResponse.json(
      { error: "Er ging iets mis bij het starten van de betaling. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
