/**
 * Google Calendar-integratie (one-way) via OAuth.
 *
 * De studio-eigenaar koppelt zijn Google-agenda met één klik in /admin/instellingen
 * ("Koppel Google Agenda"). Daarna verschijnt elke betaalde boeking als afspraak
 * in de gekozen agenda, en verdwijnt hij weer bij annulering.
 *
 * ── EENMALIGE SETUP (Google Cloud, ~5 min) ─────────────────────────────────
 * Nodig zijn twee omgevingsvariabelen (Vercel), daarna gaat alles via de knop:
 *   GOOGLE_OAUTH_CLIENT_ID     = OAuth-client-id
 *   GOOGLE_OAUTH_CLIENT_SECRET = OAuth-client-secret
 *
 * In Google Cloud Console: project → "Google Calendar API" inschakelen →
 * "OAuth consent screen" instellen (External, testgebruikers = je eigen Gmail) →
 * "Credentials" → "OAuth client ID" (type: Web application) → bij "Authorized
 * redirect URIs" exact deze URL toevoegen:
 *   https://booking.muziekstudioalkmaar.nl/api/admin/google/callback
 * (De exacte URL staat ook in het admin-scherm.) Client-id + secret in Vercel
 * zetten. Vervolgens in /admin/instellingen op "Koppel Google Agenda" klikken.
 *
 * De refresh-token + gekozen agenda worden in site_settings bewaard (niet in
 * env). Geen extra npm-dependency: alles via fetch.
 */

import { getSettings, setSetting } from "@/lib/settings";
import { TIMEZONE } from "@/lib/config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TIMEOUT_MS = 8000;

/** Scopes: events beheren + agenda's kunnen opsommen + e-mail tonen. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
].join(" ");

const REFRESH_TOKEN_KEY = "google_refresh_token";
const CALENDAR_ID_KEY = "google_calendar_id";
const CONNECTED_EMAIL_KEY = "google_connected_email";

export function clientId(): string | undefined {
  return process.env.GOOGLE_OAUTH_CLIENT_ID;
}
export function clientSecret(): string | undefined {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET;
}
/** Zijn de OAuth-credentials (env) aanwezig? (Eenmalige setup gedaan.) */
export function hasOAuthCredentials(): boolean {
  return Boolean(clientId() && clientSecret());
}

/** De redirect-URI die exact in Google Cloud geregistreerd moet zijn. */
export function redirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/admin/google/callback`;
}

/** Bouwt de Google-toestemmings-URL (met CSRF-state). */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId()!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline", // nodig voor een refresh-token
    prompt: "consent", // forceer refresh-token, ook bij herkoppelen
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    if (!res.ok) {
      console.error(`Google-token faalde (${res.status}):`, await safeText(res));
      return null;
    }
    return (await res.json()) as TokenResponse;
  } catch (err) {
    console.error("Google-token-verzoek mislukt:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** E-mailadres uit een id_token halen (payload, geen verificatie nodig — komt
 *  rechtstreeks van Google over TLS). */
function emailFromIdToken(idToken?: string): string {
  if (!idToken) return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

/**
 * Wisselt de authorization-code in voor tokens en slaat de refresh-token +
 * gekoppelde e-mail op. Geeft het e-mailadres terug bij succes, anders null.
 */
export async function exchangeCodeAndStore(code: string): Promise<{ email: string } | null> {
  if (!hasOAuthCredentials()) return null;
  const tokens = await postToken({
    code,
    client_id: clientId()!,
    client_secret: clientSecret()!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  if (!tokens?.refresh_token) {
    console.error("Google gaf geen refresh-token terug (opnieuw koppelen met prompt=consent).");
    return null;
  }
  const email = emailFromIdToken(tokens.id_token);
  await setSetting(REFRESH_TOKEN_KEY, tokens.refresh_token);
  await setSetting(CONNECTED_EMAIL_KEY, email);
  // Standaard de primaire agenda; de eigenaar kan later een andere kiezen.
  const existing = await getSettings([CALENDAR_ID_KEY]);
  if (!existing[CALENDAR_ID_KEY]) await setSetting(CALENDAR_ID_KEY, "primary");
  cachedAccess = null;
  return { email };
}

// Access-token kort in-memory cachen zodat niet elke boeking een roundtrip kost.
let cachedAccess: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  if (!hasOAuthCredentials()) return null;
  if (cachedAccess && cachedAccess.expiresAt > Date.now() + 60000) return cachedAccess.token;
  const s = await getSettings([REFRESH_TOKEN_KEY]);
  const refreshToken = s[REFRESH_TOKEN_KEY];
  if (!refreshToken) return null;
  const tokens = await postToken({
    refresh_token: refreshToken,
    client_id: clientId()!,
    client_secret: clientSecret()!,
    grant_type: "refresh_token",
  });
  if (!tokens?.access_token) return null;
  cachedAccess = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  return tokens.access_token;
}

/** Is de agenda daadwerkelijk gekoppeld (credentials + refresh-token aanwezig)? */
export async function isGcalConnected(): Promise<boolean> {
  if (!hasOAuthCredentials()) return false;
  const s = await getSettings([REFRESH_TOKEN_KEY]);
  return Boolean(s[REFRESH_TOKEN_KEY]);
}

/** Status voor het admin-scherm. */
export async function getGcalStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  email: string;
  calendarId: string;
  redirectUri: string;
}> {
  const s = await getSettings([REFRESH_TOKEN_KEY, CONNECTED_EMAIL_KEY, CALENDAR_ID_KEY]);
  return {
    configured: hasOAuthCredentials(),
    connected: hasOAuthCredentials() && Boolean(s[REFRESH_TOKEN_KEY]),
    email: s[CONNECTED_EMAIL_KEY] ?? "",
    calendarId: s[CALENDAR_ID_KEY] ?? "primary",
    redirectUri: redirectUri(),
  };
}

/** Lijst van agenda's waar de eigenaar in kan schrijven (voor de keuzelijst). */
export async function listCalendars(): Promise<{ id: string; summary: string; primary: boolean }[]> {
  const token = await getAccessToken();
  if (!token) return [];
  try {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: { id: string; summary: string; primary?: boolean }[];
    };
    return (data.items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: Boolean(c.primary) }));
  } catch {
    return [];
  }
}

export async function setCalendarId(calendarId: string): Promise<void> {
  await setSetting(CALENDAR_ID_KEY, calendarId || "primary");
}

/** Ontkoppelt: trekt de toestemming in bij Google en wist de opgeslagen gegevens. */
export async function disconnect(): Promise<void> {
  const s = await getSettings([REFRESH_TOKEN_KEY]);
  if (s[REFRESH_TOKEN_KEY]) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s[REFRESH_TOKEN_KEY])}`, {
        method: "POST",
      });
    } catch {
      /* intrekken mag stilletjes falen */
    }
  }
  await setSetting(REFRESH_TOKEN_KEY, "");
  await setSetting(CONNECTED_EMAIL_KEY, "");
  await setSetting(CALENDAR_ID_KEY, "");
  cachedAccess = null;
}

async function gcalFetch(path: string, init: RequestInit): Promise<Response | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const s = await getSettings([CALENDAR_ID_KEY]);
  const calendarId = encodeURIComponent(s[CALENDAR_ID_KEY] || "primary");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    console.error("Google Calendar-verzoek mislukt:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Zet een boeking in de agenda. Retourneert het event-id (voor latere
 * verwijdering bij annulering), of null bij falen/niet-gekoppeld — non-fataal.
 */
export async function createCalendarEvent(opts: {
  summary: string;
  description: string;
  start: Date;
  end: Date;
}): Promise<string | null> {
  if (!hasOAuthCredentials()) return null;
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
  if (!hasOAuthCredentials() || !eventId) return false;
  const res = await gcalFetch(`/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  if (!res) return false;
  // 404/410 = al weg — ook prima.
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
