import { createHmac, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query } from "@/lib/db";

const COOKIE_NAME = "ma_session";
const SESSION_TTL_DAYS = 30;
const LOGIN_TOKEN_TTL_MINUTES = 30;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET ontbreekt of is te kort (min. 16 tekens).");
  }
  return s;
}

// ─── Sessie-tokens (HMAC-ondertekend, in een cookie) ──────────────────────

interface SessionPayload {
  customerId: string;
  email: string;
  exp: number; // unix-seconden
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createSessionToken(customerId: string, email: string): string {
  const payload: SessionPayload = {
    customerId,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 86400,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  // Constante-tijd vergelijking.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Huidige ingelogde klant (server-side), of null. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE_NAME)?.value);
}

export async function setSessionCookie(customerId: string, email: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, createSessionToken(customerId, email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// ─── Magic-link login-tokens ──────────────────────────────────────────────

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Maakt een eenmalig login-token aan, slaat alleen de hash op, geeft de ruwe waarde terug. */
export async function createLoginToken(email: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + LOGIN_TOKEN_TTL_MINUTES * 60000);
  await query(
    `INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ($1, $2, $3)`,
    [hashToken(raw), email.trim().toLowerCase(), expires],
  );
  return raw;
}

/**
 * Wisselt een ruw login-token in: geeft het e-mailadres terug als het geldig en
 * ongebruikt is, en markeert het meteen als gebruikt (eenmalig).
 */
export async function consumeLoginToken(raw: string): Promise<string | null> {
  const rows = await query<{ email: string }>(
    `UPDATE login_tokens SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING email`,
    [hashToken(raw)],
  );
  return rows[0]?.email ?? null;
}

/** Vindt of maakt een klant op e-mail (voor login zonder eerdere boeking). */
export async function findOrCreateCustomerByEmail(email: string): Promise<{ id: string; name: string }> {
  const normalized = email.trim().toLowerCase();
  const rows = await query<{ id: string; name: string }>(
    `INSERT INTO customers (name, email, phone)
     VALUES ('', $1, '')
     ON CONFLICT (lower(email)) DO UPDATE SET updated_at = now()
     RETURNING id, name`,
    [normalized],
  );
  return rows[0];
}
