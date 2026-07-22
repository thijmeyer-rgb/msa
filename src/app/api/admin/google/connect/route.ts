import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildAuthUrl, hasOAuthCredentials } from "@/lib/gcal";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "g_oauth_state";

/**
 * GET /api/admin/google/connect — start de Google-toestemmingsflow.
 * Zet een CSRF-state in een cookie en stuurt door naar Google.
 */
export async function GET() {
  if (!hasOAuthCredentials()) {
    return NextResponse.json(
      { error: "OAuth-credentials ontbreken (GOOGLE_OAUTH_CLIENT_ID/SECRET)." },
      { status: 503 },
    );
  }
  const state = randomBytes(16).toString("base64url");
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
  });
  return NextResponse.redirect(buildAuthUrl(state));
}
