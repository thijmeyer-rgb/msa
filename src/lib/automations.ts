import { query } from "@/lib/db";
import { sendReminderEmail, sendRecoveryEmail, sendReviewRequestEmail } from "@/lib/email";
import { createAutoDiscountCode } from "@/lib/discounts";
import { getSettings } from "@/lib/settings";
import { TIMEZONE, slotLabel, type DaypartId } from "@/lib/config";

// Standaardwaarden (overschrijfbaar via /admin/instellingen).
const DEFAULT_REVIEW_URL = "https://g.page/r/CXQ3bsqyLYGyEBM/review";
const DEFAULT_REVIEW_REWARD_CENTS = 1000; // €10

function amsterdamDateStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Stuurt een herinnering naar iedereen die MORGEN een (betaalde) sessie heeft
 * en nog geen herinnering kreeg. Vermindert no-shows. Idempotent via
 * reminder_sent_at, dus dubbel draaien mailt niet dubbel.
 */
export async function sendDueReminders(): Promise<number> {
  const tomorrow = amsterdamDateStr(1);
  const rows = await query<{
    id: string;
    booking_date: string;
    daypart: DaypartId | null;
    start_ts: string | null;
    end_ts: string | null;
    name: string;
    email: string;
  }>(
    `SELECT b.id, b.booking_date, b.daypart, b.start_ts, b.end_ts, c.name, c.email
       FROM bookings b JOIN customers c ON c.id = b.customer_id
      WHERE b.status = 'paid' AND b.booking_date = $1 AND b.reminder_sent_at IS NULL
        AND c.email <> ''`,
    [tomorrow],
  );

  let sent = 0;
  for (const b of rows) {
    try {
      await sendReminderEmail({
        customerName: b.name || "muzikant",
        customerEmail: b.email,
        date: b.booking_date,
        slotLabelOverride: slotLabel(b.daypart, b.start_ts, b.end_ts),
        priceCents: 0,
      });
      await query(`UPDATE bookings SET reminder_sent_at = now() WHERE id = $1`, [b.id]);
      sent++;
    } catch (err) {
      console.error(`Herinnering voor boeking ${b.id} mislukt:`, err);
    }
  }
  return sent;
}

/**
 * Stuurt een 'je boeking is niet afgerond'-mail naar klanten die recent zijn
 * afgehaakt (expired/failed/canceled) en het slot niet alsnog hebben geboekt.
 * Eén keer per boeking (recovery_sent_at) en alleen voor toekomstige datums.
 */
export async function sendDueRecoveries(): Promise<number> {
  const today = amsterdamDateStr(0);
  const rows = await query<{
    id: string;
    booking_date: string;
    daypart: DaypartId;
    name: string;
    email: string;
  }>(
    `SELECT b.id, b.booking_date, b.daypart, c.name, c.email
       FROM bookings b JOIN customers c ON c.id = b.customer_id
      WHERE b.status IN ('expired','failed','canceled')
        AND b.recovery_sent_at IS NULL
        AND b.mollie_payment_id IS NOT NULL
        AND b.created_at >= now() - interval '3 days'
        AND b.booking_date >= $1
        AND c.email <> ''
        -- niet mailen als het slot inmiddels (door wie dan ook) betaald is
        AND NOT EXISTS (
          SELECT 1 FROM bookings p
           WHERE p.booking_date = b.booking_date AND p.daypart = b.daypart AND p.status = 'paid'
        )`,
    [today],
  );

  let sent = 0;
  for (const b of rows) {
    try {
      await sendRecoveryEmail({
        customerName: b.name || "muzikant",
        customerEmail: b.email,
        date: b.booking_date,
        daypart: b.daypart,
      });
      await query(`UPDATE bookings SET recovery_sent_at = now() WHERE id = $1`, [b.id]);
      sent++;
    } catch (err) {
      console.error(`Recovery-mail voor boeking ${b.id} mislukt:`, err);
    }
  }
  return sent;
}

/**
 * Stuurt 1 dag ná de sessie een review-verzoek met een automatisch
 * gegenereerde eenmalige kortingscode als bedankje. Idempotent via
 * review_requested_at. Review-URL + beloning instelbaar in /admin/instellingen.
 */
export async function sendDueReviewRequests(): Promise<number> {
  const yesterday = amsterdamDateStr(-1);
  const s = await getSettings(["review_url", "review_reward_cents"]);
  const reviewUrl = s.review_url || DEFAULT_REVIEW_URL;
  const rewardCents = s.review_reward_cents ? parseInt(s.review_reward_cents, 10) : DEFAULT_REVIEW_REWARD_CENTS;
  if (!reviewUrl || !rewardCents) return 0;

  const rows = await query<{ id: string; name: string; email: string }>(
    `SELECT b.id, c.name, c.email
       FROM bookings b JOIN customers c ON c.id = b.customer_id
      WHERE b.status = 'paid' AND b.booking_date = $1 AND b.review_requested_at IS NULL
        AND c.email <> ''`,
    [yesterday],
  );

  let sent = 0;
  for (const b of rows) {
    try {
      const code = await createAutoDiscountCode(rewardCents, 90);
      await sendReviewRequestEmail({
        customerName: b.name || "muzikant",
        customerEmail: b.email,
        reviewUrl,
        code,
        rewardCents,
      });
      await query(`UPDATE bookings SET review_requested_at = now() WHERE id = $1`, [b.id]);
      sent++;
    } catch (err) {
      console.error(`Review-mail voor boeking ${b.id} mislukt:`, err);
    }
  }
  return sent;
}
