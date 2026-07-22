import type { PoolClient } from "pg";
import { withTransaction, query, isUniqueViolation, isExclusionViolation } from "@/lib/db";
import { mollie, mollieAmount } from "@/lib/mollie";
import { sendBookingConfirmation, sendAdminBookingNotification } from "@/lib/email";
import {
  DAYPART_BY_ID,
  PENDING_TTL_MINUTES,
  STUDIO,
  formatEuro,
  daypartStart,
  daypartEnd,
  flexWindow,
  isValidFlexStart,
  slotLabel,
  MIN_LEAD_MINUTES,
  FLEX_DURATION_MINUTES,
  type DaypartId,
} from "@/lib/config";
import { isSlotBookable, isDateWithinWindow } from "@/lib/availability";
import { consumeCredits, grantCredits } from "@/lib/credits";
import { validateDiscount, incrementDiscountUse } from "@/lib/discounts";
import { isNukiEnabled, createKeypadCode } from "@/lib/nuki";

/**
 * Genereert (indien Nuki actief is) een keypad-toegangscode voor deze boeking,
 * geldig van 15 min vóór tot 15 min ná het dagdeel. Slaat de code op de boeking
 * op en geeft hem terug voor in de bevestigingsmail. Non-fataal.
 */
async function provisionAccessCode(
  bookingId: string,
  from: Date,
  until: Date,
  label: string,
): Promise<string | null> {
  if (!isNukiEnabled()) return null;
  // 15 min speling rond het tijdvenster.
  const codeFrom = new Date(from.getTime() - 15 * 60000);
  const codeUntil = new Date(until.getTime() + 15 * 60000);
  const pin = await createKeypadCode({ name: `MSA ${label}`, from: codeFrom, until: codeUntil });
  if (pin) {
    try {
      await query(`UPDATE bookings SET access_code = $1 WHERE id = $2`, [pin, bookingId]);
    } catch (err) {
      console.error(`Toegangscode opslaan voor ${bookingId} mislukt:`, err);
    }
  }
  return pin;
}

export class SlotTakenError extends Error {
  constructor() {
    super("Dit dagdeel is zojuist door iemand anders geboekt.");
    this.name = "SlotTakenError";
  }
}
export class SlotNotBookableError extends Error {
  constructor(msg = "Dit dagdeel is niet (meer) boekbaar.") {
    super(msg);
    this.name = "SlotNotBookableError";
  }
}
export class InvalidDiscountError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidDiscountError";
  }
}

interface CreateBookingInput {
  date: string;
  daypart: DaypartId;
  name: string;
  email: string;
  phone: string;
  numPeople?: number;
  discountCode?: string;
}

interface CreateBookingResult {
  bookingId: string;
  checkoutUrl: string;
}

/**
 * Maakt een boeking aan en start de Mollie-betaling.
 *
 * Stappen:
 *  1. Server-side validatie dat het slot boekbaar is (tijdvenster).
 *  2. In één transactie: klant vinden/aanmaken + boeking als 'pending'
 *     invoegen. De partial unique index (booking_date, daypart) garandeert
 *     dat er maar ÉÉN actieve boeking per slot kan bestaan — bij een race
 *     krijgt de tweede insert een unique violation → SlotTakenError.
 *  3. Mollie-betaling aanmaken en het payment-id op de boeking zetten.
 *
 * Het slot is nu gereserveerd (pending) en komt automatisch vrij als de klant
 * niet op tijd betaalt (zie expireStalePendingBookings + webhook).
 */
export async function createBookingAndPayment(input: CreateBookingInput): Promise<CreateBookingResult> {
  const dp = DAYPART_BY_ID[input.daypart];
  if (!dp) throw new SlotNotBookableError("Onbekend dagdeel.");

  // 1. Validatie tijdvenster/beschikbaarheid (snelle voorcheck).
  if (!(await isSlotBookable(input.date, input.daypart))) {
    throw new SlotNotBookableError();
  }

  // 1b. Kortingscode valideren (indien opgegeven) en eindbedrag bepalen.
  let discountCents = 0;
  let discountCodeId: string | null = null;
  if (input.discountCode) {
    const res = await validateDiscount(input.discountCode, dp.priceCents, input.email);
    if (!res.ok) throw new InvalidDiscountError(res.reason ?? "Ongeldige kortingscode.");
    discountCents = res.discountCents ?? 0;
    discountCodeId = res.codeId ?? null;
  }
  const chargeCents = dp.priceCents - discountCents;

  const expiresAt = new Date(Date.now() + PENDING_TTL_MINUTES * 60 * 1000);

  // 2. Klant + pending boeking in één transactie.
  const bookingId = await withTransaction(async (client: PoolClient) => {
    const customerId = await upsertCustomer(client, input.name, input.email, input.phone);

    // Geef een eventueel verlopen 'pending' voor dit slot eerst atomair vrij,
    // zodat de partial unique index de nieuwe boeking niet onterecht blokkeert.
    // Dit maakt correctheid onafhankelijk van de opruim-cron.
    await client.query(
      `UPDATE bookings SET status = 'expired', updated_at = now()
        WHERE booking_date = $1 AND daypart = $2
          AND status = 'pending' AND expires_at < now()`,
      [input.date, input.daypart],
    );

    try {
      const rows = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (booking_date, daypart, kind, status, customer_id, price_cents, num_people, expires_at,
            discount_code_id, discount_cents, start_ts, end_ts)
         VALUES ($1, $2, 'daypart', 'pending', $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [input.date, input.daypart, customerId, dp.priceCents, input.numPeople ?? null, expiresAt,
         discountCodeId, discountCents, daypartStart(input.date, dp), daypartEnd(input.date, dp)],
      );
      return rows.rows[0].id;
    } catch (err) {
      // Unieke-sleutel- of overlap-schending = slot al door een ander vergrendeld.
      if (isUniqueViolation(err) || isExclusionViolation(err)) throw new SlotTakenError();
      throw err;
    }
  });

  // 3. Mollie-betaling. Buiten de transactie (externe call).
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  try {
    const desc =
      discountCents > 0
        ? `${STUDIO.name} — ${dp.label} ${input.date} (${formatEuro(chargeCents)}, korting ${formatEuro(discountCents)})`
        : `${STUDIO.name} — ${dp.label} ${input.date} (${formatEuro(chargeCents)})`;
    const payment = await mollie().payments.create({
      amount: mollieAmount(chargeCents),
      description: desc,
      redirectUrl: `${baseUrl}/boeking/${bookingId}`,
      webhookUrl: `${baseUrl}/api/webhooks/mollie`,
      metadata: { type: "booking", bookingId },
    });

    await query(`UPDATE bookings SET mollie_payment_id = $1, updated_at = now() WHERE id = $2`, [
      payment.id,
      bookingId,
    ]);

    const checkoutUrl = payment.getCheckoutUrl();
    if (!checkoutUrl) throw new Error("Mollie gaf geen checkout-URL terug.");
    return { bookingId, checkoutUrl };
  } catch (err) {
    // Betaling aanmaken mislukt: geef het slot direct weer vrij.
    await query(
      `UPDATE bookings SET status = 'failed', updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [bookingId],
    );
    throw err;
  }
}

/**
 * Boekt een dagdeel met uren-tegoed (geen Mollie-betaling). De boeking is
 * meteen definitief ('paid', paid_with_credit=true).
 *
 * In één transactie: slot vergrendelen via de unique index + credits FIFO
 * afboeken met row-locking. Onvoldoende tegoed of bezet slot → rollback, dus
 * er wordt niets half afgeboekt.
 */
export async function createBookingWithCredits(input: {
  customerId: string;
  date: string;
  daypart: DaypartId;
  numPeople?: number;
}): Promise<{ bookingId: string }> {
  const dp = DAYPART_BY_ID[input.daypart];
  if (!dp) throw new SlotNotBookableError("Onbekend dagdeel.");
  if (!(await isSlotBookable(input.date, input.daypart))) throw new SlotNotBookableError();

  const minutes = dp.hours * 60;

  const bookingId = await withTransaction(async (client) => {
    // Verlopen pending voor dit slot vrijgeven (zoals bij de betaalflow).
    await client.query(
      `UPDATE bookings SET status = 'expired', updated_at = now()
        WHERE booking_date = $1 AND daypart = $2 AND status = 'pending' AND expires_at < now()`,
      [input.date, input.daypart],
    );

    let id: string;
    try {
      const rows = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (booking_date, daypart, kind, status, customer_id, price_cents, num_people,
            paid_with_credit, credit_minutes_used, start_ts, end_ts)
         VALUES ($1,$2,'daypart','paid',$3,$4,$5,true,$6,$7,$8)
         RETURNING id`,
        [input.date, input.daypart, input.customerId, dp.priceCents, input.numPeople ?? null, minutes,
         daypartStart(input.date, dp), daypartEnd(input.date, dp)],
      );
      id = rows.rows[0].id;
    } catch (err) {
      if (isUniqueViolation(err) || isExclusionViolation(err)) throw new SlotTakenError();
      throw err;
    }

    // Credits afboeken (gooit InsufficientCreditsError → rollback).
    await consumeCredits(client, input.customerId, minutes);
    return id;
  });

  // Bevestigingsmail + admin-notificatie buiten de transactie.
  const cust = await query<{ name: string; email: string; phone: string }>(
    `SELECT name, email, phone FROM customers WHERE id = $1`,
    [input.customerId],
  );
  const accessCode = await provisionAccessCode(
    bookingId,
    daypartStart(input.date, dp),
    daypartEnd(input.date, dp),
    slotLabel(input.daypart),
  );
  if (cust[0]?.email) {
    try {
      await sendBookingConfirmation({
        customerName: cust[0].name || "muzikant",
        customerEmail: cust[0].email,
        date: input.date,
        daypart: input.daypart,
        priceCents: dp.priceCents,
        paidWithCredit: true,
        accessCode: accessCode ?? undefined,
      });
    } catch (err) {
      console.error(`⚠️ Bevestigingsmail (tegoed) voor ${bookingId} mislukt:`, err);
    }
  }
  try {
    await sendAdminBookingNotification({
      customerName: cust[0]?.name || "muzikant",
      customerEmail: cust[0]?.email ?? "",
      customerPhone: cust[0]?.phone ?? "",
      date: input.date,
      daypart: input.daypart,
      priceCents: dp.priceCents,
      paidWithCredit: true,
    });
  } catch (err) {
    console.error(`⚠️ Admin-notificatie (tegoed) voor ${bookingId} mislukt:`, err);
  }

  return { bookingId };
}

/**
 * Boekt een FLEXIBEL blok van 2 uur op een vrije starttijd (alleen abonnees,
 * betaald met tegoed). Overlap met dagdelen of andere flexblokken wordt op
 * databaseniveau uitgesloten (exclusion constraint) → bij overlap SlotTakenError.
 */
export async function createFlexBookingWithCredits(input: {
  customerId: string;
  date: string;
  startTime: string; // "HH:MM"
}): Promise<{ bookingId: string }> {
  if (!isDateWithinWindow(input.date)) throw new SlotNotBookableError();
  if (!isValidFlexStart(input.startTime))
    throw new SlotNotBookableError("Ongeldige starttijd voor een blok van 2 uur.");
  const { start, end } = flexWindow(input.date, input.startTime);
  if (start.getTime() - Date.now() < MIN_LEAD_MINUTES * 60000)
    throw new SlotNotBookableError("Te kort dag — kies een latere starttijd.");

  const minutes = FLEX_DURATION_MINUTES;

  const bookingId = await withTransaction(async (client) => {
    let id: string;
    try {
      const rows = await client.query<{ id: string }>(
        `INSERT INTO bookings
           (booking_date, daypart, kind, status, customer_id, price_cents,
            paid_with_credit, credit_minutes_used, start_ts, end_ts)
         VALUES ($1, NULL, 'flex', 'paid', $2, 0, true, $3, $4, $5)
         RETURNING id`,
        [input.date, input.customerId, minutes, start, end],
      );
      id = rows.rows[0].id;
    } catch (err) {
      // Overlap met een dagdeel of ander flexblok → tijd al bezet.
      if (isExclusionViolation(err) || isUniqueViolation(err)) throw new SlotTakenError();
      throw err;
    }
    await consumeCredits(client, input.customerId, minutes);
    return id;
  });

  // Bevestiging + admin-notificatie + toegangscode.
  const label = slotLabel(null, start, end);
  const accessCode = await provisionAccessCode(bookingId, start, end, label);
  const cust = await query<{ name: string; email: string; phone: string }>(
    `SELECT name, email, phone FROM customers WHERE id = $1`,
    [input.customerId],
  );
  if (cust[0]?.email) {
    try {
      await sendBookingConfirmation({
        customerName: cust[0].name || "muzikant",
        customerEmail: cust[0].email,
        date: input.date,
        slotLabelOverride: label,
        priceCents: 0,
        paidWithCredit: true,
        accessCode: accessCode ?? undefined,
      });
    } catch (err) {
      console.error(`⚠️ Bevestigingsmail (flex) voor ${bookingId} mislukt:`, err);
    }
  }
  try {
    await sendAdminBookingNotification({
      customerName: cust[0]?.name || "muzikant",
      customerEmail: cust[0]?.email ?? "",
      customerPhone: cust[0]?.phone ?? "",
      date: input.date,
      slotLabelOverride: label,
      priceCents: 0,
      paidWithCredit: true,
    });
  } catch (err) {
    console.error(`⚠️ Admin-notificatie (flex) voor ${bookingId} mislukt:`, err);
  }

  return { bookingId };
}

/**
 * Geeft bij annulering van een met-tegoed betaalde boeking de uren terug als
 * een nieuwe refund-batch (geldig zoals de standaard pakket-geldigheid).
 */
export async function refundBookingCreditsIfAny(bookingId: string): Promise<void> {
  const rows = await query<{ customer_id: string; credit_minutes_used: number; paid_with_credit: boolean }>(
    `SELECT customer_id, credit_minutes_used, paid_with_credit FROM bookings WHERE id = $1`,
    [bookingId],
  );
  const b = rows[0];
  if (b?.paid_with_credit && b.credit_minutes_used > 0) {
    await grantCredits(b.customer_id, b.credit_minutes_used, {
      source: "refund",
      note: `Terugbetaling annulering boeking ${bookingId}`,
      createdBy: "admin",
      validityDays: 90,
    });
  }
}

async function upsertCustomer(
  client: PoolClient,
  name: string,
  email: string,
  phone: string,
): Promise<string> {
  // Bestaande klant (op e-mail) hergebruiken en gegevens verversen.
  const res = await client.query<{ id: string }>(
    `INSERT INTO customers (name, email, phone)
     VALUES ($1, $2, $3)
     ON CONFLICT (lower(email)) DO UPDATE
       SET name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = now()
     RETURNING id`,
    [name, email, phone],
  );
  return res.rows[0].id;
}

// ─── Betaalstatus-afhandeling (aangeroepen vanuit de Mollie-webhook) ──────

type MollieStatus = "open" | "pending" | "authorized" | "paid" | "failed" | "expired" | "canceled";

/**
 * Verwerkt de actuele betaalstatus van een boeking. Idempotent: meerdere
 * webhook-aanroepen voor hetzelfde payment leveren hetzelfde eindresultaat.
 *
 * De statusovergang gebeurt met een voorwaardelijke UPDATE (WHERE status=...),
 * zodat een dubbele aanroep niet dubbel afhandelt (bijv. de mail niet twee
 * keer verstuurt).
 */
export async function handlePaymentStatus(molliePaymentId: string, status: MollieStatus): Promise<void> {
  if (status === "paid") {
    await markBookingPaid(molliePaymentId);
    return;
  }

  if (status === "failed" || status === "expired" || status === "canceled") {
    // Slot vrijgeven: alleen als de boeking nog 'pending' is.
    await query(
      `UPDATE bookings SET status = $2, updated_at = now()
        WHERE mollie_payment_id = $1 AND status = 'pending'`,
      [molliePaymentId, status],
    );
    return;
  }

  // open / pending / authorized: nog niets definitief, laat 'pending' staan.
}

/**
 * Zet een boeking op 'paid' en verstuurt de bevestigingsmail — precies één keer.
 */
async function markBookingPaid(molliePaymentId: string): Promise<void> {
  const result = await withTransaction(async (client) => {
    // Vergrendel de rij zodat gelijktijdige webhooks elkaar niet in de weg zitten.
    const rows = await client.query<{
      id: string;
      status: string;
      booking_date: string;
      daypart: DaypartId;
      price_cents: number;
      discount_cents: number;
      customer_id: string;
      discount_code_id: string | null;
    }>(
      `SELECT id, status, booking_date, daypart, price_cents, discount_cents, customer_id, discount_code_id
         FROM bookings WHERE mollie_payment_id = $1 FOR UPDATE`,
      [molliePaymentId],
    );

    const booking = rows.rows[0];
    if (!booking) return null; // onbekend payment — negeren.

    if (booking.status === "paid") return null; // al verwerkt — idempotent.

    if (booking.status === "pending") {
      await client.query(
        `UPDATE bookings SET status = 'paid', expires_at = NULL, updated_at = now()
          WHERE id = $1`,
        [booking.id],
      );
      // Kortingscode-gebruik precies één keer ophogen (bij deze overgang).
      if (booking.discount_code_id) await incrementDiscountUse(booking.discount_code_id, client);
      return booking;
    }

    // Rand-geval: betaling komt binnen nadat het slot al is vrijgegeven
    // (expired/failed/canceled), bijv. klant betaalde net na de timeout.
    // Probeer het slot te heroveren; lukt dat niet (iemand anders heeft het
    // slot nu), dan is handmatige terugbetaling nodig.
    try {
      await client.query(
        `UPDATE bookings SET status = 'paid', expires_at = NULL, updated_at = now()
          WHERE id = $1`,
        [booking.id],
      );
      return booking;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Slot inmiddels door een ander bezet. Markeer voor handmatige actie.
        await client.query(
          `UPDATE bookings SET notes = COALESCE(notes,'') ||
             '[LET OP: betaald na timeout, slot al bezet — terugbetaling nodig] ',
             updated_at = now() WHERE id = $1`,
          [booking.id],
        );
        console.error(
          `⚠️ Boeking ${booking.id} betaald na timeout maar slot bezet. Handmatige terugbetaling nodig.`,
        );
        return null;
      }
      throw err;
    }
  });

  // Buiten de transactie: bevestigingsmail + admin-notificatie, alleen bij een echte overgang.
  if (result) {
    const customer = await query<{ name: string; email: string; phone: string }>(
      `SELECT name, email, phone FROM customers WHERE id = $1`,
      [result.customer_id],
    );
    if (customer[0]) {
      const rdp = DAYPART_BY_ID[result.daypart];
      const accessCode = await provisionAccessCode(
        result.id,
        daypartStart(result.booking_date, rdp),
        daypartEnd(result.booking_date, rdp),
        slotLabel(result.daypart),
      );
      try {
        await sendBookingConfirmation({
          customerName: customer[0].name,
          customerEmail: customer[0].email,
          date: result.booking_date,
          daypart: result.daypart,
          priceCents: result.price_cents,
          accessCode: accessCode ?? undefined,
        });
      } catch (err) {
        // Mail-fout mag de boeking niet ongedaan maken; log en ga door.
        console.error(`⚠️ Bevestigingsmail voor boeking ${result.id} mislukt:`, err);
      }
      try {
        await sendAdminBookingNotification({
          customerName: customer[0].name,
          customerEmail: customer[0].email,
          customerPhone: customer[0].phone,
          date: result.booking_date,
          daypart: result.daypart,
          priceCents: result.price_cents,
          discountCents: result.discount_cents,
        });
      } catch (err) {
        console.error(`⚠️ Admin-notificatie voor boeking ${result.id} mislukt:`, err);
      }
    }
  }
}

/**
 * Verloopt 'pending' boekingen waarvan de betaaltimeout is verstreken, zodat
 * het slot weer vrijkomt. Aangeroepen door de cron-endpoint.
 */
export async function expireStalePendingBookings(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE bookings SET status = 'expired', updated_at = now()
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()
      RETURNING id`,
  );
  return rows.length;
}
