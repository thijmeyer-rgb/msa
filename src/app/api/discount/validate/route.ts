import { NextResponse } from "next/server";
import { z } from "zod";
import { validateDiscount } from "@/lib/discounts";
import { DAYPART_BY_ID, isDaypartId } from "@/lib/config";

const Schema = z.object({
  code: z.string().trim().min(1).max(40),
  daypart: z.string().refine(isDaypartId, "Ongeldig dagdeel."),
  email: z.string().trim().email().optional(),
});

/** POST /api/discount/validate — controleert een code voor het gekozen dagdeel. */
export async function POST(request: Request) {
  let data: z.infer<typeof Schema>;
  try {
    data = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, reason: "Ongeldige invoer." }, { status: 400 });
  }

  const dp = DAYPART_BY_ID[data.daypart];
  const res = await validateDiscount(data.code, dp.priceCents, data.email);
  return NextResponse.json(res);
}
