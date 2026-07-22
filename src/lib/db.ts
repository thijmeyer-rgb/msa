import { Pool, types, type PoolClient } from "pg";

// DATE-kolommen (OID 1082) als platte "YYYY-MM-DD"-string teruggeven i.p.v.
// een JS-Date. Anders parset node-postgres ze naar middernacht lokale tijd,
// waardoor de datum in UTC een dag kan verschuiven en verkeerd wordt getoond.
types.setTypeParser(1082, (value: string) => value);

/**
 * Eén gedeelde connection-pool voor de hele app. In een serverless-omgeving
 * (Vercel) wordt de pool per instance hergebruikt via een global, zodat we
 * niet bij elke request opnieuw verbinden.
 */
const globalForPool = globalThis as unknown as { pgPool?: Pool };

export const pool: Pool =
  globalForPool.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: klein pool-formaat, want elke instance heeft een eigen pool.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslConfig(),
  });

if (process.env.NODE_ENV !== "production") globalForPool.pgPool = pool;

function sslConfig() {
  const url = process.env.DATABASE_URL ?? "";
  // Managed Postgres (Neon/Supabase) vereist SSL; lokaal meestal niet.
  if (url.includes("sslmode=require") || url.includes("neon.tech") || url.includes("supabase")) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Eenvoudige query-helper. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query(text, params as never);
  return res.rows as T[];
}

/**
 * Voert `fn` uit binnen één databasetransactie. Commit bij succes, rollback
 * bij een fout. Gebruik dit voor de boekingslogica waar we een slot vergren-
 * delen en pas daarna schrijven.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres-foutcode voor schending van een unieke sleutel. */
export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION;
}

/** Postgres-foutcode voor schending van een exclusion constraint (tijdsoverlap). */
export const PG_EXCLUSION_VIOLATION = "23P01";

export function isExclusionViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err &&
    (err as { code?: string }).code === PG_EXCLUSION_VIOLATION;
}
