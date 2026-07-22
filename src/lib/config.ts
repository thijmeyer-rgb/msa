/**
 * Centrale bedrijfsconfiguratie voor Muziekstudio Alkmaar.
 *
 * ALLE tarieven en tijden staan hier. Wil je een prijs of tijd aanpassen,
 * dan hoef je alleen dit bestand te wijzigen — nergens anders.
 *
 * Bron: muziekstudioalkmaar.nl (prijzen zijn INCL. BTW zoals op de site vermeld).
 */

export const TIMEZONE = "Europe/Amsterdam";

export type DaypartId = "ochtend" | "middag" | "avond" | "latenight";

export interface Daypart {
  id: DaypartId;
  label: string;
  /** Starttijd in lokale tijd (Europe/Amsterdam), formaat "HH:MM". */
  start: string;
  /** Eindtijd in lokale tijd (Europe/Amsterdam), formaat "HH:MM". */
  end: string;
  /** Duur in hele uren — gebruikt bij urenpakketten (fase 2). */
  hours: number;
  /** Prijs in eurocenten (incl. BTW). */
  priceCents: number;
}

/** De vier dagdelen, in volgorde van de dag. */
export const DAYPARTS: Daypart[] = [
  { id: "ochtend", label: "Ochtend", start: "10:00", end: "13:00", hours: 3, priceCents: 4500 },
  { id: "middag", label: "Middag", start: "13:15", end: "16:15", hours: 3, priceCents: 5500 },
  { id: "avond", label: "Avond", start: "16:30", end: "19:30", hours: 3, priceCents: 5500 },
  { id: "latenight", label: "Late night", start: "19:45", end: "23:45", hours: 4, priceCents: 7000 },
];

export const DAYPART_BY_ID: Record<DaypartId, Daypart> = Object.fromEntries(
  DAYPARTS.map((d) => [d.id, d]),
) as Record<DaypartId, Daypart>;

export function isDaypartId(value: string): value is DaypartId {
  return value in DAYPART_BY_ID;
}

// ─── Boekingsregels ──────────────────────────────────────────────────────

/**
 * Minimale voorbereidingstijd: een dagdeel is niet meer boekbaar als het
 * binnen dit aantal minuten begint. (Klantwens: niet binnen 2 uur vooraf.)
 */
export const MIN_LEAD_MINUTES = 120;

/** Hoe ver vooruit klanten mogen boeken, in dagen. */
export const MAX_ADVANCE_DAYS = 90;

/**
 * Hoe lang een onbetaalde ('pending') boeking het slot vasthoudt voordat
 * het weer wordt vrijgegeven. Moet ruim genoeg zijn voor de Mollie-checkout.
 */
export const PENDING_TTL_MINUTES = 15;

/** Prijzen zijn incl. BTW (zoals op de website). Puur informatief/label. */
export const PRICES_INCLUDE_VAT = true;

// ─── Urenpakketten (prepaid credits) ─────────────────────────────────────
// Klant koopt een pakket → de uren komen als credits (in minuten) op het
// account, geldig tot `validityDays` na aankoop. Credits stapelen; verbruik
// gaat op volgorde van eerst-vervallend (FIFO op vervaldatum).
//
// Prijzen incl. btw, overgenomen van de website (Maandabonnementen).

export type PackageKey = "basis" | "pro" | "premium";

export interface CreditPackage {
  key: PackageKey;
  label: string;
  hours: number;
  priceCents: number;
  /** Hoe lang de gekochte uren geldig blijven na aankoop. */
  validityDays: number;
  description: string;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { key: "basis", label: "Basis", hours: 8, priceCents: 9500, validityDays: 90, description: "8 uur studiotijd" },
  { key: "pro", label: "Pro", hours: 16, priceCents: 17500, validityDays: 90, description: "16 uur studiotijd" },
  { key: "premium", label: "Premium", hours: 32, priceCents: 29900, validityDays: 90, description: "32 uur studiotijd" },
];

export const PACKAGE_BY_KEY: Record<PackageKey, CreditPackage> = Object.fromEntries(
  CREDIT_PACKAGES.map((p) => [p.key, p]),
) as Record<PackageKey, CreditPackage>;

export function isPackageKey(value: string): value is PackageKey {
  return value in PACKAGE_BY_KEY;
}

/** Uren → minuten (credits worden in minuten bijgehouden voor precisie). */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

/** Minuten → net leesbare uren, bijv. 90 → "1,5 uur". */
export function formatHours(minutes: number): string {
  const h = minutes / 60;
  const s = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",");
  return `${s} uur`;
}

// ─── Studiogegevens (voor bevestigingsmail) ──────────────────────────────

export const STUDIO = {
  name: "Muziekstudio Alkmaar",
  address: "Marconistraat 5, Alkmaar",
  phone: "+31 6 83 50 34 22",
  whatsapp: "+31 6 83 50 34 22",
  email: "info@muziekstudioalkmaar.nl",
  website: "https://www.muziekstudioalkmaar.nl",
} as const;

// ─── Tijdzone-helpers ─────────────────────────────────────────────────────

/**
 * Bepaalt de UTC-offset (in milliseconden) van een tijdzone op een gegeven
 * instant. Gebruikt Intl zodat DST (zomer-/wintertijd) automatisch klopt.
 */
function tzOffsetMs(timeZone: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // De "wandklok" in de doeltijdzone, geïnterpreteerd alsof het UTC was.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * Zet een lokale datum ("YYYY-MM-DD") + tijd ("HH:MM") in Europe/Amsterdam
 * om naar het absolute UTC-instant (een Date). DST-correct.
 */
export function amsterdamToUtc(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  // Eerste benadering: interpreteer de wandklok als UTC.
  const guessUtc = Date.UTC(y, m - 1, d, hh, mm);
  // Corrigeer met de werkelijke offset op dat moment.
  const offset = tzOffsetMs(TIMEZONE, new Date(guessUtc));
  return new Date(guessUtc - offset);
}

/** Start-instant (UTC Date) van een dagdeel op een gegeven datum. */
export function daypartStart(dateStr: string, daypart: Daypart): Date {
  return amsterdamToUtc(dateStr, daypart.start);
}

/** Eind-instant (UTC Date) van een dagdeel op een gegeven datum. */
export function daypartEnd(dateStr: string, daypart: Daypart): Date {
  return amsterdamToUtc(dateStr, daypart.end);
}

/** Prijs mooi geformatteerd, bijv. "€45,00". */
export function formatEuro(cents: number): string {
  return "€" + (cents / 100).toFixed(2).replace(".", ",");
}

// ─── Flexibel boeken (abonnees): blok van 2 uur op vrije starttijd ────────

export const FLEX_DURATION_MINUTES = 120;
/** Studio-openingstijden waarbinnen een flexibel blok moet vallen. */
export const STUDIO_OPEN = "10:00";
export const STUDIO_CLOSE = "23:45";
/** Starttijden worden per half uur aangeboden. */
export const FLEX_STEP_MINUTES = 30;

/** "HH:MM" → minuten sinds middernacht. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
/** minuten sinds middernacht → "HH:MM". */
export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Mogelijke starttijden voor een flexblok (elk +2u past binnen openingstijden). */
export function flexStartTimes(): string[] {
  const open = timeToMinutes(STUDIO_OPEN);
  const lastStart = timeToMinutes(STUDIO_CLOSE) - FLEX_DURATION_MINUTES;
  const out: string[] = [];
  for (let m = open; m <= lastStart; m += FLEX_STEP_MINUTES) out.push(minutesToTime(m));
  return out;
}

/** Start/eind-instant (UTC) van een flexblok dat op `startTime` begint. */
export function flexWindow(dateStr: string, startTime: string): { start: Date; end: Date } {
  const start = amsterdamToUtc(dateStr, startTime);
  const end = new Date(start.getTime() + FLEX_DURATION_MINUTES * 60 * 1000);
  return { start, end };
}

/** Valideert dat een starttijd een geldig flexblok binnen openingstijden geeft. */
export function isValidFlexStart(startTime: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(startTime)) return false;
  const m = timeToMinutes(startTime);
  return m >= timeToMinutes(STUDIO_OPEN) && m + FLEX_DURATION_MINUTES <= timeToMinutes(STUDIO_CLOSE);
}

/** "HH:MM" in Europe/Amsterdam voor een instant. */
export function formatTimeAmsterdam(ts: string | Date): string {
  return new Intl.DateTimeFormat("nl-NL", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

/** Leesbaar label voor een boeking: dagdeel óf flexibel tijdvenster. */
export function slotLabel(
  daypart: DaypartId | null | undefined,
  startTs?: string | Date | null,
  endTs?: string | Date | null,
): string {
  if (daypart && DAYPART_BY_ID[daypart]) {
    const d = DAYPART_BY_ID[daypart];
    return `${d.label} (${d.start} tot ${d.end})`;
  }
  if (startTs && endTs) {
    return `Flexibel blok (${formatTimeAmsterdam(startTs)}–${formatTimeAmsterdam(endTs)})`;
  }
  return "je sessie";
}
