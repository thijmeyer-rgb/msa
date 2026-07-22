/**
 * Nuki-integratie: genereert per boeking een tijdelijke keypad-toegangscode via
 * de Nuki Web API (Advanced API). De code werkt alléén tijdens het geboekte
 * dagdeel en wordt daarna automatisch ongeldig.
 *
 * ── STATUS ────────────────────────────────────────────────────────────────
 * Volledig gebouwd, maar UITGESCHAKELD tot de hardware er is. Actief zodra deze
 * twee omgevingsvariabelen zijn ingesteld (Vercel):
 *   NUKI_API_TOKEN      = je Nuki Web API-token (Advanced API)
 *   NUKI_SMARTLOCK_ID   = id van je Nuki Smart Lock (deur waar de keypad aan hangt)
 *
 * Zonder die variabelen doet deze module niets en verloopt het boeken zoals nu.
 *
 * ── TE VERIFIËREN met de echte keypad ──────────────────────────────────────
 * De exacte endpoint/velden van de Nuki Web API kunnen per versie iets afwijken
 * (auth-type voor keypad-codes = 13). Zodra de keypad is gekoppeld testen we of
 * een gegenereerde code de deur daadwerkelijk opent, en stellen we zo nodig bij.
 */

const NUKI_BASE = "https://api.nuki.io";
const KEYPAD_CODE_TYPE = 13; // Nuki auth-type voor een keypad-PIN
const TIMEOUT_MS = 8000;

/** Alleen actief als beide sleutels zijn ingesteld. */
export function isNukiEnabled(): boolean {
  return Boolean(process.env.NUKI_API_TOKEN && process.env.NUKI_SMARTLOCK_ID);
}

/** Genereert een 6-cijferige PIN (begint niet met 0, geen simpele reeks). */
export function generatePin(): string {
  const banned = new Set(["123456", "654321", "111111", "000000", "121212"]);
  for (let i = 0; i < 20; i++) {
    let pin = String(Math.floor(1 + Math.random() * 9)); // 1-9
    for (let d = 0; d < 5; d++) pin += String(Math.floor(Math.random() * 10));
    if (!banned.has(pin) && new Set(pin).size > 1) return pin;
  }
  return "428173";
}

async function nukiFetch(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${NUKI_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.NUKI_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Maakt een keypad-code aan die geldig is tussen `from` en `until`.
 * Retourneert de PIN bij succes, of null (dan valt de boeking terug op de
 * standaard "ik open de deur op afstand"-instructie).
 */
export async function createKeypadCode(opts: {
  name: string;
  from: Date;
  until: Date;
}): Promise<string | null> {
  if (!isNukiEnabled()) return null;
  const smartlockId = process.env.NUKI_SMARTLOCK_ID!;
  const pin = generatePin();
  try {
    const res = await nukiFetch(`/smartlock/${smartlockId}/auth`, {
      method: "PUT",
      body: JSON.stringify({
        name: opts.name,
        type: KEYPAD_CODE_TYPE,
        code: Number(pin),
        allowedFromDate: opts.from.toISOString(),
        allowedUntilDate: opts.until.toISOString(),
        smartlockIds: [Number(smartlockId)],
      }),
    });
    if (!res.ok && res.status !== 204) {
      console.error(`Nuki keypad-code aanmaken faalde (${res.status}):`, await safeText(res));
      return null;
    }
    return pin;
  } catch (err) {
    console.error("Nuki keypad-code aanmaken mislukt:", err);
    return null;
  }
}

/**
 * Ruimt verlopen keypad-codes op (dagelijkse cron). Nuki schakelt codes na de
 * einddatum al uit; dit verwijdert ze definitief zodat het overzicht schoon blijft.
 */
export async function cleanupExpiredKeypadCodes(): Promise<number> {
  if (!isNukiEnabled()) return 0;
  const smartlockId = process.env.NUKI_SMARTLOCK_ID!;
  try {
    const res = await nukiFetch(`/smartlock/${smartlockId}/auth`, { method: "GET" });
    if (!res.ok) return 0;
    const auths = (await res.json()) as { id: string; type: number; allowedUntilDate?: string }[];
    const now = Date.now();
    let removed = 0;
    for (const a of auths) {
      if (a.type === KEYPAD_CODE_TYPE && a.allowedUntilDate && new Date(a.allowedUntilDate).getTime() < now) {
        const del = await nukiFetch(`/smartlock/${smartlockId}/auth/${a.id}`, { method: "DELETE" });
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
