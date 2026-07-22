import type { PoolClient } from "pg";
import { query, isUniqueViolation } from "@/lib/db";

export interface DiscountRow {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  new_customers_only: boolean;
  active: boolean;
}

export interface DiscountResult {
  ok: boolean;
  reason?: string;
  codeId?: string;
  code?: string;
  discountCents?: number;
  finalCents?: number;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Minimaal te betalen bedrag na korting (Mollie kan geen €0 verwerken). */
const MIN_CHARGE_CENTS = 100;

/**
 * Valideert een kortingscode voor een bepaalde prijs. Controleert bestaan,
 * actief, verloop, max. gebruik en 'alleen nieuwe klanten'. Geeft de te geven
 * korting en het eindbedrag terug.
 */
export async function validateDiscount(
  rawCode: string,
  basePriceCents: number,
  email?: string,
): Promise<DiscountResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "Vul een code in." };

  const rows = await query<DiscountRow>(
    `SELECT * FROM discount_codes WHERE upper(code) = $1`,
    [code],
  );
  const d = rows[0];
  if (!d || !d.active) return { ok: false, reason: "Ongeldige code." };
  if (d.expires_at && new Date(d.expires_at) < new Date())
    return { ok: false, reason: "Deze code is verlopen." };
  if (d.max_uses != null && d.used_count >= d.max_uses)
    return { ok: false, reason: "Deze code is niet meer geldig." };

  if (d.new_customers_only) {
    if (!email) return { ok: false, reason: "Vul eerst je e-mailadres in." };
    const prior = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bookings b
         JOIN customers c ON c.id = b.customer_id
        WHERE lower(c.email) = lower($1) AND b.status = 'paid'`,
      [email],
    );
    if ((prior[0]?.n ?? 0) > 0)
      return { ok: false, reason: "Deze code is alleen voor nieuwe klanten." };
  }

  let discountCents =
    d.type === "percent"
      ? Math.round((basePriceCents * d.value) / 100)
      : Math.min(d.value, basePriceCents);

  // Nooit onder het minimale te betalen bedrag zakken.
  discountCents = Math.min(discountCents, Math.max(0, basePriceCents - MIN_CHARGE_CENTS));

  return {
    ok: true,
    codeId: d.id,
    code: d.code,
    discountCents,
    finalCents: basePriceCents - discountCents,
  };
}

/** Verhoogt de gebruiksteller (aangeroepen bij bevestigde betaling, één keer). */
export async function incrementDiscountUse(codeId: string, client?: PoolClient): Promise<void> {
  const sql = `UPDATE discount_codes SET used_count = used_count + 1 WHERE id = $1`;
  if (client) await client.query(sql, [codeId]);
  else await query(sql, [codeId]);
}

/** Genereert een unieke, leesbare kortingscode (bv. voor de review-beloning). */
export function generateCode(prefix = "MSA"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // zonder verwarrende tekens
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

/**
 * Maakt automatisch een eenmalige kortingscode aan (bv. review-beloning):
 * vast bedrag in centen, 1× te gebruiken, verloopt na `validityDays` dagen.
 * Retourneert de code. Herprobeert bij een (zeldzame) code-botsing.
 */
export async function createAutoDiscountCode(
  valueCents: number,
  validityDays = 90,
): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateCode("MSA");
    try {
      await query(
        `INSERT INTO discount_codes (code, type, value, max_uses, expires_at, auto_generated)
         VALUES ($1, 'fixed', $2, 1, now() + ($3 || ' days')::interval, true)`,
        [code, valueCents, validityDays],
      );
      return code;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("Kon geen unieke kortingscode genereren.");
}
