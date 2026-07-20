import { NextResponse } from "next/server";
import { consumeLoginToken, findOrCreateCustomerByEmail, setSessionCookie } from "@/lib/auth";

/**
 * GET /api/auth/callback?token=...
 * Wisselt de magic-link in voor een sessie en stuurt door naar /account.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(request.url).origin;

  if (!token) {
    return NextResponse.redirect(`${base}/account/login?error=missing`);
  }

  const email = await consumeLoginToken(token);
  if (!email) {
    return NextResponse.redirect(`${base}/account/login?error=invalid`);
  }

  const customer = await findOrCreateCustomerByEmail(email);
  await setSessionCookie(customer.id, email);
  return NextResponse.redirect(`${base}/account`);
}
