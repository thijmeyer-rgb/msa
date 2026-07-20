import { query } from "@/lib/db";
import {
  DAYPARTS,
  DAYPART_BY_ID,
  MAX_ADVANCE_DAYS,
  MIN_LEAD_MINUTES,
  TIMEZONE,
  daypartStart,
  type Daypart,
  type DaypartId,
} from "@/lib/config";

export interface SlotAvailability {
  daypart: DaypartId;
  label: string;
  start: string;
  end: string;
  hours: number;
  priceCents: number;
  available: boolean;
  /** Reden waarom niet beschikbaar (voor debugging/UI), optioneel. */
  reason?: "booked" | "blocked" | "past" | "too-soon";
}

/** Huidige datum in Europe/Amsterdam als "YYYY-MM-DD". */
export function todayInAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Valideert dat een datum binnen het toegestane boekingsvenster valt. */
export function isDateWithinWindow(dateStr: string): boolean {
  const today = todayInAmsterdam();
  if (dateStr < today) return false;
  const max = new Date();
  max.setUTCDate(max.getUTCDate() + MAX_ADVANCE_DAYS);
  const maxStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(max);
  return dateStr <= maxStr;
}

/**
 * Is dit dagdeel op deze datum nog boekbaar qua tijd? Niet meer boekbaar als
 * de start al voorbij is óf binnen MIN_LEAD_MINUTES ligt.
 */
export function isBookableInTime(dateStr: string, daypart: Daypart, now: Date = new Date()): boolean {
  const start = daypartStart(dateStr, daypart);
  const leadMs = MIN_LEAD_MINUTES * 60 * 1000;
  return start.getTime() - now.getTime() >= leadMs;
}

/**
 * Berekent de beschikbaarheid van alle dagdelen op een gegeven datum.
 * Combineert: tijdsregels + actieve boekingen + blokkades.
 */
export async function getAvailabilityForDate(dateStr: string): Promise<SlotAvailability[]> {
  // Actieve boekingen houden een slot bezet: 'paid' altijd, en 'pending'
  // alleen zolang de betaaltimeout nog niet is verstreken. Zo komt een niet-
  // betaald slot direct weer vrij, zonder afhankelijk te zijn van de cron.
  const booked = await query<{ daypart: DaypartId }>(
    `SELECT daypart FROM bookings
      WHERE booking_date = $1
        AND (status = 'paid'
             OR (status = 'pending' AND expires_at > now()))`,
    [dateStr],
  );
  const bookedSet = new Set(booked.map((b) => b.daypart));

  // Blokkades (handmatig + Google). daypart NULL = hele dag.
  const blocks = await query<{ daypart: DaypartId | null }>(
    `SELECT daypart FROM blocks WHERE block_date = $1`,
    [dateStr],
  );
  const wholeDayBlocked = blocks.some((b) => b.daypart === null);
  const blockedSet = new Set(blocks.filter((b) => b.daypart !== null).map((b) => b.daypart!));

  const now = new Date();

  return DAYPARTS.map((dp): SlotAvailability => {
    let available = true;
    let reason: SlotAvailability["reason"];

    if (bookedSet.has(dp.id)) {
      available = false;
      reason = "booked";
    } else if (wholeDayBlocked || blockedSet.has(dp.id)) {
      available = false;
      reason = "blocked";
    } else if (!isBookableInTime(dateStr, dp, now)) {
      available = false;
      // Onderscheid tussen 'al voorbij' en 'te kort dag'.
      reason = daypartStart(dateStr, dp).getTime() <= now.getTime() ? "past" : "too-soon";
    }

    return {
      daypart: dp.id,
      label: dp.label,
      start: dp.start,
      end: dp.end,
      hours: dp.hours,
      priceCents: dp.priceCents,
      available,
      reason,
    };
  });
}

/** Snelle single-slot check (server-side validatie vóór boeken). */
export async function isSlotBookable(dateStr: string, daypartId: DaypartId): Promise<boolean> {
  if (!isDateWithinWindow(dateStr)) return false;
  const dp = DAYPART_BY_ID[daypartId];
  if (!isBookableInTime(dateStr, dp)) return false;
  const all = await getAvailabilityForDate(dateStr);
  return all.find((s) => s.daypart === daypartId)?.available ?? false;
}
