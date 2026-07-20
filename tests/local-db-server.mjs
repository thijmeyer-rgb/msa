/**
 * Lokale ontwikkel-database: draait een echte Postgres (PGlite) in-process en
 * stelt hem beschikbaar op het Postgres-wireprotocol via een TCP-socket, zodat
 * de `pg`-client van de app er gewoon mee kan praten.
 *
 * ALLEEN voor lokaal testen. In productie gebruik je Neon/Supabase.
 *
 *   node tests/local-db-server.mjs
 *   # zet dan in .env.local:  DATABASE_URL="postgres://postgres@127.0.0.1:5433/postgres"
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, "../src/db/schema.sql"), "utf8");

const db = await PGlite.create();
await db.exec(schema);
console.log("✓ Schema geladen in lokale PGlite-database.");

const server = new PGLiteSocketServer({ db, port: 5433, host: "127.0.0.1" });
await server.start();
console.log("✓ Lokale DB luistert op 127.0.0.1:5433 (postgres://postgres@127.0.0.1:5433/postgres)");
console.log("  Stop met Ctrl+C.");

process.on("SIGINT", async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
