import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

const Schema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(40),
});

/** POST /api/account/profile — naam/telefoon van de ingelogde klant bijwerken. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  let data: z.infer<typeof Schema>;
  try {
    data = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Vul een geldige naam en telefoonnummer in." }, { status: 400 });
  }

  await query(`UPDATE customers SET name = $1, phone = $2, updated_at = now() WHERE id = $3`, [
    data.name,
    data.phone,
    session.customerId,
  ]);
  return NextResponse.json({ ok: true });
}
