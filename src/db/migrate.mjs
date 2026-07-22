/**
 * Past het databaseschema toe (idempotent). Draait automatisch mee in de
 * Vercel-build, zodat de database altijd up-to-date is vóór de site live gaat.
 * Ook los te draaien: `npm run db:migrate`.
 *
 * Gedrag:
 *  - Geen DATABASE_URL → overslaan (build gaat gewoon door; bv. previews).
 *  - Wel DATABASE_URL maar migratie faalt → build faalt (zodat je het merkt).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("• db:migrate overgeslagen (geen DATABASE_URL).");
    return;
  }

  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  const ssl =
    connectionString.includes("sslmode=require") ||
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase")
      ? { rejectUnauthorized: false }
      : undefined;

  const pool = new pg.Pool({ connectionString, ssl, connectionTimeoutMillis: 15000 });
  try {
    await pool.query(schema);
    console.log("✓ Schema toegepast.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ Migratie mislukt:", err.message);
  process.exit(1);
});
