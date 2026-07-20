import { NextResponse } from "next/server";
import { z } from "zod";
import { grantCredits, revokeCredits } from "@/lib/credits";
import { hoursToMinutes } from "@/lib/config";

const Schema = z.object({
  action: z.enum(["grant", "revoke"]),
  customerId: z.string().uuid(),
  hours: z.coerce.number().positive().max(1000),
  note: z.string().max(200).optional(),
  // Alleen bij 'grant': geldigheidsduur in dagen. Leeg = 90 dagen. 0 = nooit verlopen.
  validityDays: z.coerce.number().int().min(0).max(3650).optional(),
});

/**
 * POST /api/admin/credits — uren toekennen of intrekken voor een klant.
 *  { action:'grant'|'revoke', customerId, hours, note?, validityDays? }
 */
export async function POST(request: Request) {
  let data: z.infer<typeof Schema>;
  try {
    data = Schema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors[0]?.message : "Ongeldige invoer.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const minutes = hoursToMinutes(data.hours);

  if (data.action === "grant") {
    const validityDays = data.validityDays === undefined ? 90 : data.validityDays === 0 ? null : data.validityDays;
    await grantCredits(data.customerId, minutes, {
      source: "admin",
      note: data.note ?? "Handmatig toegekend",
      createdBy: "admin",
      validityDays,
    });
    return NextResponse.json({ ok: true });
  }

  const removed = await revokeCredits(data.customerId, minutes);
  return NextResponse.json({ ok: true, removedMinutes: removed });
}
