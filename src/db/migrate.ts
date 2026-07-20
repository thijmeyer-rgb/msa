/**
 * Past het databaseschema toe. Idempotent — veilig herhaald uit te voeren.
 *
 *   npm run db:migrate
 *
 * Vereist DATABASE_URL in de omgeving (.env.local wordt automatisch geladen
 * als je via `npm run` draait en Next het inlaadt; anders exporteer je hem).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("✗ DATABASE_URL ontbreekt. Zet hem in je omgeving of .env.local.");
    process.exit(1);
  }

  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  const ssl =
    connectionString.includes("sslmode=require") ||
    connectionString.includes("neon.tech") ||
    connectionString.includes("supabase")
      ? { rejectUnauthorized: false }
      : undefined;

  const pool = new Pool({ connectionString, ssl });
  try {
    await pool.query(schema);
    console.log("✓ Schema toegepast.");
  } catch (err) {
    console.error("✗ Migratie mislukt:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
