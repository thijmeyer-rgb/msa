import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeAndStore } from "@/lib/gcal";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";

/**
 * GET /api/admin/google/callback — Google stuurt hierheen terug met ?code.
 * Verifieert de CSRF-state, wisselt de code in voor tokens en gaat terug
 * naar het instellingen-scherm met een statusmelding.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const settings = new URL("/admin/instellingen", url.origin);

  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  const error = url.searchParams.get("error");
  if (error) {
    settings.searchParams.set("google", "error");
    return NextResponse.redirect(settings);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !expectedState || state !== expectedState) {
    settings.searchParams.set("google", "error");
    return NextResponse.redirect(settings);
  }

  const result = await exchangeCodeAndStore(code);
  settings.searchParams.set("google", result ? "connected" : "error");
  return NextResponse.redirect(settings);
}
