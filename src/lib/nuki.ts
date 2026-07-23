/**
 * Nuki-integratie: genereert per boeking een tijdelijke keypad-toegangscode via
 * de Nuki Web API (Advanced API). De code werkt alléén tijdens het geboekte
 * tijdvenster en wordt daarna automatisch ongeldig.
 *
 * ── AANZETTEN ─────────────────────────────────────────────────────────────
 * In /admin/instellingen → "Nuki deurcodes": plak je Nuki Web API-token, kies
 * je slot uit de lijst en klik "Testcode aanmaken". Geen Vercel-gedoe nodig.
 * (Voor de volledigheid blijven de omgevingsvariabelen NUKI_API_TOKEN en
 * NUKI_SMARTLOCK_ID ook werken; instellingen uit het scherm gaan vóór.)
 *
 * ── REGELS VAN DE NUKI-API (geverifieerd tegen de officiële docs) ──────────
 *  · Aanmaken: PUT https://api.nuki.io/smartlock/{smartlockId}/auth
 *  · type 13 = keypad-PIN
 *  · smartlockIds moet een ARRAY zijn
 *  · name mag MAXIMAAL 20 tekens zijn
 *  · code = 6 cijfers uit 1-9, ZONDER nul, niet beginnend met "12",
 *    en niet gelijk aan een al bestaande PIN
 *  · datums in ISO-8601 met Z
 * Zie developer.nuki.io (Web API Example: Manage PIN-Codes for your Nuki Keypad).
 */

import { getSettings, setSetting } from "@/lib/settings";

const NUKI_BASE = "https://api.nuki.io";
const KEYPAD_CODE_TYPE = 13; // Nuki auth-type voor een keypad-PIN
const TIMEOUT_MS = 8000;
const MAX_NAME_LENGTH = 20;

const TOKEN_KEY = "nuki_api_token";
const SMARTLOCK_KEY = "nuki_smartlock_id";

/** Token + slot-id: eerst uit de admin-instellingen, anders uit env. */
export async function getNukiConfig(): Promise<{ token: string; smartlockId: string } | null> {
  const s = await getSettings([TOKEN_KEY, SMARTLOCK_KEY]);
  const token = s[TOKEN_KEY] || process.env.NUKI_API_TOKEN || "";
  const smartlockId = s[SMARTLOCK_KEY] || process.env.NUKI_SMARTLOCK_ID || "";
  if (!token || !smartlockId) return null;
  return { token, smartlockId };
}

/** Is er een token bekend? (Slot hoeft nog niet gekozen te zijn.) */
export async function getNukiToken(): Promise<string> {
  const s = await getSettings([TOKEN_KEY]);
  return s[TOKEN_KEY] || process.env.NUKI_API_TOKEN || "";
}

/** Volledig ingesteld = token én gekozen slot. */
export async function isNukiEnabled(): Promise<boolean> {
  return (await getNukiConfig()) !== null;
}

export async function saveNukiToken(token: string): Promise<void> {
  await setSetting(TOKEN_KEY, token);
}
export async function saveNukiSmartlock(smartlockId: string): Promise<void> {
  await setSetting(SMARTLOCK_KEY, smartlockId);
}
export async function clearNukiConfig(): Promise<void> {
  await setSetting(TOKEN_KEY, "");
  await setSetting(SMARTLOCK_KEY, "");
}

/**
 * Genereert een geldige Nuki-keypad-PIN: 6 cijfers uit 1-9 (géén nul),
 * niet beginnend met "12", geen enkel-cijfer-reeks, en niet in `taken`.
 */
export function generatePin(taken: Set<string> = new Set()): string {
  const digit = () => String(1 + Math.floor(Math.random() * 9)); // 1..9
  for (let i = 0; i < 200; i++) {
    let pin = "";
    for (let d = 0; d < 6; d++) pin += digit();
    if (pin.startsWith("12")) continue; // door Nuki verboden
    if (new Set(pin).size === 1) continue; // 111111 e.d.
    if (taken.has(pin)) continue;
    return pin;
  }
  // Uiterst onwaarschijnlijk; deterministische terugval die alle regels volgt.
  for (let n = 313131; n <= 999999; n++) {
    const pin = String(n);
    if (!pin.includes("0") && !pin.startsWith("12") && new Set(pin).size > 1 && !taken.has(pin)) {
      return pin;
    }
  }
  throw new Error("Geen vrije Nuki-PIN beschikbaar.");
}

/** Kort de naam in tot de door Nuki toegestane 20 tekens. */
export function nukiName(label: string): string {
  return label.length <= MAX_NAME_LENGTH ? label : label.slice(0, MAX_NAME_LENGTH).trimEnd();
}

async function nukiFetch(token: string, path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${NUKI_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface Smartlock {
  smartlockId: string;
  name: string;
}

/** Haalt de sloten van het account op (voor de keuzelijst in admin). */
export async function listSmartlocks(token: string): Promise<Smartlock[]> {
  try {
    const res = await nukiFetch(token, "/smartlock", { method: "GET" });
    if (!res.ok) return [];
    const data = (await res.json()) as { smartlockId: number | string; name?: string }[];
    return data.map((l) => ({ smartlockId: String(l.smartlockId), name: l.name ?? String(l.smartlockId) }));
  } catch (err) {
    console.error("Nuki-sloten ophalen mislukt:", err);
    return [];
  }
}

/** Bestaande keypad-PINs (om dubbele codes te voorkomen). */
async function existingPins(token: string, smartlockId: string): Promise<Set<string>> {
  try {
    const res = await nukiFetch(token, `/smartlock/${smartlockId}/auth`, { method: "GET" });
    if (!res.ok) return new Set();
    const auths = (await res.json()) as { type: number; code?: number }[];
    const out = new Set<string>();
    for (const a of auths) if (a.type === KEYPAD_CODE_TYPE && a.code) out.add(String(a.code));
    return out;
  } catch {
    return new Set();
  }
}

/**
 * Maakt een keypad-code die geldig is tussen `from` en `until`.
 * Retourneert de PIN bij succes, of null (dan valt de boeking terug op de
 * standaard "ik open de deur op afstand"-instructie).
 */
export async function createKeypadCode(opts: {
  name: string;
  from: Date;
  until: Date;
}): Promise<string | null> {
  const cfg = await getNukiConfig();
  if (!cfg) return null;
  const { token, smartlockId } = cfg;

  const taken = await existingPins(token, smartlockId);
  const name = nukiName(opts.name);

  // Twee pogingen: bij een botsing (Nuki weigert een dubbele PIN) opnieuw.
  for (let attempt = 0; attempt < 2; attempt++) {
    const pin = generatePin(taken);
    try {
      const res = await nukiFetch(token, `/smartlock/${smartlockId}/auth`, {
        method: "PUT",
        body: JSON.stringify({
          smartlockIds: [Number(smartlockId)],
          name,
          type: KEYPAD_CODE_TYPE,
          code: Number(pin),
          allowedFromDate: opts.from.toISOString(),
          allowedUntilDate: opts.until.toISOString(),
        }),
      });
      if (res.ok || res.status === 204) return pin;
      const body = await safeText(res);
      console.error(`Nuki keypad-code aanmaken faalde (${res.status}):`, body);
      // 409/422 kan duiden op een dubbele PIN → nog één poging met een andere.
      if (res.status === 409 || res.status === 422) {
        taken.add(pin);
        continue;
      }
      return null;
    } catch (err) {
      console.error("Nuki keypad-code aanmaken mislukt:", err);
      return null;
    }
  }
  return null;
}

/**
 * Maakt een testcode die 15 minuten geldig is, zodat de eigenaar kan
 * controleren of de keypad de deur echt opent. Geeft de PIN of een foutmelding.
 */
export async function createTestCode(): Promise<{ pin: string } | { error: string }> {
  const cfg = await getNukiConfig();
  if (!cfg) return { error: "Nog geen token of slot ingesteld." };
  const now = new Date();
  const pin = await createKeypadCode({
    name: "MSA testcode",
    from: new Date(now.getTime() - 60_000),
    until: new Date(now.getTime() + 15 * 60_000),
  });
  if (!pin) return { error: "Nuki weigerde de code. Controleer token en slot (zie serverlog)." };
  return { pin };
}

/**
 * Ruimt verlopen keypad-codes op (dagelijkse cron). Nuki schakelt codes na de
 * einddatum al uit; dit verwijdert ze definitief zodat het overzicht schoon blijft.
 */
export async function cleanupExpiredKeypadCodes(): Promise<number> {
  const cfg = await getNukiConfig();
  if (!cfg) return 0;
  const { token, smartlockId } = cfg;
  try {
    const res = await nukiFetch(token, `/smartlock/${smartlockId}/auth`, { method: "GET" });
    if (!res.ok) return 0;
    const auths = (await res.json()) as { id: string; type: number; allowedUntilDate?: string }[];
    const now = Date.now();
    let removed = 0;
    for (const a of auths) {
      if (a.type === KEYPAD_CODE_TYPE && a.allowedUntilDate && new Date(a.allowedUntilDate).getTime() < now) {
        const del = await nukiFetch(token, `/smartlock/${smartlockId}/auth/${a.id}`, { method: "DELETE" });
        if (del.ok || del.status === 204) removed++;
      }
    }
    return removed;
  } catch (err) {
    console.error("Nuki opruimen mislukt:", err);
    return 0;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
