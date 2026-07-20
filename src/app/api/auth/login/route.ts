import { NextResponse } from "next/server";
import { z } from "zod";
import { createLoginToken } from "@/lib/auth";
import { sendLoginLink } from "@/lib/email";

const Schema = z.object({ email: z.string().trim().email().max(200) });

/**
 * POST /api/auth/login  { email }
 * Mailt een magic-link. Antwoordt altijd 'ok' (verklapt niet of het adres
 * bestaat) om account-enumeratie te voorkomen.
 */
export async function POST(request: Request) {
  let email: string;
  try {
    email = Schema.parse(await request.json()).email;
  } catch {
    return NextResponse.json({ error: "Ongeldig e-mailadres." }, { status: 400 });
  }

  try {
    const raw = await createLoginToken(email);
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
    const link = `${base}/api/auth/callback?token=${encodeURIComponent(raw)}`;
    await sendLoginLink(email, link);
  } catch (err) {
    console.error("Login-link versturen mislukt:", err);
    // We geven nog steeds ok terug; log intern.
  }
  return NextResponse.json({ ok: true });
}
