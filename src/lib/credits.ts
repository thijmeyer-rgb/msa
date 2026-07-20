import type { PoolClient } from "pg";
import { query, pool } from "@/lib/db";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Onvoldoende uren-tegoed.");
    this.name = "InsufficientCreditsError";
  }
}

export interface CreditBatch {
  id: string;
  minutes_total: number;
  minutes_remaining: number;
  expires_at: string | null;
  source: string;
  package_key: string | null;
  note: string | null;
  created_at: string;
}

/** Actueel saldo (minuten) van een klant: som van niet-verlopen batches. */
export async function getBalanceMinutes(customerId: string): Promise<number> {
  const rows = await query<{ total: number }>(
    `SELECT COALESCE(SUM(minutes_remaining),0)::int AS total
       FROM credit_batches
      WHERE customer_id = $1
        AND minutes_remaining > 0
        AND (expires_at IS NULL OR expires_at > now())`,
    [customerId],
  );
  return rows[0]?.total ?? 0;
}

/** Alle (nog geldige) batches van een klant, eerst-vervallend eerst. */
export async function getActiveBatches(customerId: string): Promise<CreditBatch[]> {
  return query<CreditBatch>(
    `SELECT id, minutes_total, minutes_remaining, expires_at, source, package_key, note, created_at
       FROM credit_batches
      WHERE customer_id = $1
        AND minutes_remaining > 0
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at ASC NULLS LAST`,
    [customerId],
  );
}

interface GrantOptions {
  source?: "purchase" | "admin" | "refund";
  packageKey?: string | null;
  molliePaymentId?: string | null;
  note?: string | null;
  createdBy?: string;
  validityDays?: number | null; // null = verloopt nooit
}

/**
 * Kent credits toe (nieuwe batch). Kan binnen een bestaande transactie draaien
 * (geef `client` mee) of standalone.
 */
export async function grantCredits(
  customerId: string,
  minutes: number,
  opts: GrantOptions = {},
  client?: PoolClient,
): Promise<string> {
  const expiresAt =
    opts.validityDays == null
      ? null
      : new Date(Date.now() + opts.validityDays * 86400 * 1000);
  const exec = client ?? pool;
  const rows = await exec.query<{ id: string }>(
    `INSERT INTO credit_batches
       (customer_id, minutes_total, minutes_remaining, expires_at, source, package_key, mollie_payment_id, note, created_by)
     VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      customerId,
      minutes,
      expiresAt,
      opts.source ?? "admin",
      opts.packageKey ?? null,
      opts.molliePaymentId ?? null,
      opts.note ?? null,
      opts.createdBy ?? "system",
    ],
  );
  return rows.rows[0].id;
}

/**
 * Verbruikt `minutes` credits van een klant binnen een transactie. Trekt FIFO
 * af van de batches die het eerst verlopen. Vergrendelt de batch-rijen
 * (FOR UPDATE) zodat twee gelijktijdige boekingen niet hetzelfde tegoed dubbel
 * kunnen uitgeven. Gooit InsufficientCreditsError als er te weinig is.
 */
export async function consumeCredits(
  client: PoolClient,
  customerId: string,
  minutes: number,
): Promise<void> {
  const { rows: batches } = await client.query<{ id: string; minutes_remaining: number }>(
    `SELECT id, minutes_remaining
       FROM credit_batches
      WHERE customer_id = $1
        AND minutes_remaining > 0
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at ASC NULLS LAST
      FOR UPDATE`,
    [customerId],
  );

  let need = minutes;
  for (const batch of batches) {
    if (need <= 0) break;
    const take = Math.min(need, batch.minutes_remaining);
    await client.query(
      `UPDATE credit_batches SET minutes_remaining = minutes_remaining - $1 WHERE id = $2`,
      [take, batch.id],
    );
    need -= take;
  }
  if (need > 0) throw new InsufficientCreditsError();
}

/**
 * Admin: neemt credits weg (bijv. correctie). Trekt FIFO af; geeft het werkelijk
 * afgenomen aantal terug (kan minder zijn dan gevraagd als saldo lager is).
 */
export async function revokeCredits(customerId: string, minutes: number): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await balanceInTx(client, customerId);
    const toTake = Math.min(minutes, before);
    if (toTake > 0) await consumeCredits(client, customerId, toTake);
    await client.query("COMMIT");
    return toTake;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function balanceInTx(client: PoolClient, customerId: string): Promise<number> {
  const { rows } = await client.query<{ total: number }>(
    `SELECT COALESCE(SUM(minutes_remaining),0)::int AS total
       FROM credit_batches
      WHERE customer_id = $1 AND minutes_remaining > 0
        AND (expires_at IS NULL OR expires_at > now())`,
    [customerId],
  );
  return rows[0]?.total ?? 0;
}
