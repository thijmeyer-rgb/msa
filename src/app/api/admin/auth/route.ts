import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_DAYS,
  checkAdminPassword,
  createAdminToken,
} from "@/lib/admin-session";

export const dynamic = "force-dynamic";

/** POST /api/admin/auth — inloggen met het admin-wachtwoord. */
export async function POST(request: Request) {
  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    /* lege body → faalt hieronder netjes */
  }

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Admin niet geconfigureerd." }, { status: 503 });
  }
  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: "Onjuist wachtwoord." }, { status: 401 });
  }

  const store = await cookies();
  store.set(ADMIN_COOKIE, await createAdminToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_DAYS * 86400,
  });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/auth — uitloggen. */
export async function DELETE() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
