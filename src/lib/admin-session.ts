/**
 * Admin-sessies: ondertekende cookie i.p.v. HTTP Basic Auth.
 *
 * Werkt met Web Crypto (crypto.subtle) zodat dezelfde code zowel in de
 * edge-middleware als in Node-routes draait. Het token is `exp.signature`
 * met signature = HMAC-SHA256(secret, "admin:" + exp).
 */

export const ADMIN_COOKIE = "ma_admin";
export const ADMIN_SESSION_TTL_DAYS = 30;

function secret(): string {
  // AUTH_SECRET (zelfde als magic-links) heeft de voorkeur; val terug op het
  // admin-wachtwoord zodat login ook werkt als alleen ADMIN_PASSWORD is gezet.
  const s = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("AUTH_SECRET/ADMIN_PASSWORD ontbreekt.");
  return s;
}

function b64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(sig);
}

/** Constante-tijd vergelijking. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function createAdminToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_DAYS * 86400;
  return `${exp}.${await hmac(`admin:${exp}`)}`;
}

export async function verifyAdminToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  try {
    return safeEqual(sig, await hmac(`admin:${expStr}`));
  } catch {
    return false;
  }
}

/** Controleert het opgegeven wachtwoord tegen ADMIN_PASSWORD. */
export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(password, expected);
}
