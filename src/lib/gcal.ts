/**
 * Google Calendar-integratie (one-way): elke betaalde boeking wordt als
 * afspraak in de studio-agenda gezet, zodat je altijd ziet wanneer de studio
 * verhuurd is. Bij annulering verdwijnt de afspraak weer.
 *
 * ── STATUS ────────────────────────────────────────────────────────────────
 * Volledig gebouwd, maar UITGESCHAKELD tot deze drie omgevingsvariabelen zijn
 * ingesteld (Vercel):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL = e-mail van het service-account
 *                                  (xxx@project.iam.gserviceaccount.com)
 *   GOOGLE_SERVICE_ACCOUNT_KEY   = de private key uit het JSON-sleutelbestand
 *                                  (de "private_key"-waarde, \n mag als tekst)
 *   GOOGLE_CALENDAR_ID           = id van de agenda (meestal je Gmail-adres,
 *                                  of het id onder Agenda-instellingen)
 *
 * Setup (eenmalig): Google Cloud Console → project → "Google Calendar API"
 * inschakelen → Service account aanmaken → JSON-sleutel downloaden → in
 * Google Agenda de agenda DELEN met het service-account-e-mailadres met
 * rechten "Wijzigingen aanbrengen in afspraken".
 *
 * Geen extra npm-dependency nodig: het JWT wordt met node:crypto ondertekend.
 */

import { createSign } from "node:crypto";
import { TIMEZONE } from "@/lib/config";

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 8000;

/** Alleen actief als alle drie de sleutels zijn ingesteld. */
export function isGcalEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY &&
      process.env.GOOGLE_CALENDAR_ID,
  );
}

function privateKey(): string {
  // Vercel-env-vars kunnen de key met letterlijke "\n" bevatten.
  return (process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "").replace(/\\n/g, "\n");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// Kort in-memory cachen zodat niet elke boeking een token-roundtrip kost.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey()).toString("base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) {
      console.error(`Google-token ophalen faalde (${res.status}):`, await safeText(res));
      return null;
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  } catch (err) {
    console.error("Google-token ophalen mislukt:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function gcalFetch(path: string, init: RequestInit): Promise<Response | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}${path}`,
      {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      },
    );
  } catch (err) {
    console.error("Google Calendar-verzoek mislukt:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Zet een boeking in de agenda. Retourneert het event-id (voor latere
 * verwijdering bij annulering), of null bij falen — non-fataal.
 */
export async function createCalendarEvent(opts: {
  summary: string;
  description: string;
  start: Date;
  end: Date;
}): Promise<string | null> {
  if (!isGcalEnabled()) return null;
  const res = await gcalFetch(`/events`, {
    method: "POST",
    body: JSON.stringify({
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.start.toISOString(), timeZone: TIMEZONE },
      end: { dateTime: opts.end.toISOString(), timeZone: TIMEZONE },
    }),
  });
  if (!res) return null;
  if (!res.ok) {
    console.error(`Google Calendar-event aanmaken faalde (${res.status}):`, await safeText(res));
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

/** Verwijdert een event (bij annulering). Non-fataal. */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  if (!isGcalEnabled() || !eventId) return false;
  const res = await gcalFetch(`/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  if (!res) return false;
  // 410 = al verwijderd — ook prima.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error(`Google Calendar-event verwijderen faalde (${res.status}):`, await safeText(res));
    return false;
  }
  return true;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
