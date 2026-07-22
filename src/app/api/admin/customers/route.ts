import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ParsedCustomer {
  name: string;
  email: string;
  phone: string;
}

/**
 * Parseert één regel klantgegevens. Kolommen mogen gescheiden zijn door
 * tab, puntkomma of komma (CSV/plakken uit Excel). Het e-mailadres wordt
 * herkend aan de @, een telefoonnummer aan cijfers — de kolomvolgorde
 * maakt dus niet uit; de rest van de tekst is de naam.
 */
function parseLine(line: string): ParsedCustomer | null {
  const parts = line
    .split(/[\t;,]/)
    .map((p) => p.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return null;

  let email = "";
  let phone = "";
  const nameParts: string[] = [];
  for (const p of parts) {
    if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) email = p;
    else if (!phone && /^[+0-9][0-9 ()-]{7,}$/.test(p)) phone = p;
    else nameParts.push(p);
  }
  if (!email) return null;
  return { name: nameParts.join(" "), email: email.toLowerCase(), phone };
}

/**
 * POST /api/admin/customers — bulk-import: plak regels met naam, e-mail en
 * telefoonnummer. Bestaande klanten (zelfde e-mail) worden aangevuld, niet
 * overschreven met lege waarden.
 */
export async function POST(request: Request) {
  let text = "";
  try {
    text = String(((await request.json()) as { text?: unknown }).text ?? "");
  } catch {
    /* leeg → 400 hieronder */
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return NextResponse.json({ error: "Geen regels om te importeren." }, { status: 400 });
  }
  if (lines.length > 2000) {
    return NextResponse.json({ error: "Maximaal 2000 regels per import." }, { status: 400 });
  }

  let imported = 0;
  const skipped: string[] = [];
  for (const line of lines) {
    // Kopregel ("naam;email;telefoon") stilletjes overslaan.
    if (/^naam[\t;,]/i.test(line) || /^name[\t;,]/i.test(line)) continue;
    const parsed = parseLine(line);
    if (!parsed) {
      skipped.push(line);
      continue;
    }
    await query(
      `INSERT INTO customers (name, email, phone)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO UPDATE SET
         name  = CASE WHEN customers.name  = '' THEN EXCLUDED.name  ELSE customers.name  END,
         phone = CASE WHEN customers.phone = '' THEN EXCLUDED.phone ELSE customers.phone END,
         updated_at = now()`,
      [parsed.name, parsed.email, parsed.phone],
    );
    imported++;
  }

  return NextResponse.json({ imported, skipped });
}

/** GET /api/admin/customers — klanten met hun actuele uren-saldo (minuten). */
export async function GET() {
  const customers = await query(
    `SELECT c.id, c.name, c.email, c.phone,
            COALESCE((
              SELECT SUM(b.minutes_remaining) FROM credit_batches b
               WHERE b.customer_id = c.id AND b.minutes_remaining > 0
                 AND (b.expires_at IS NULL OR b.expires_at > now())
            ), 0)::int AS balance_minutes
       FROM customers c
      ORDER BY c.name NULLS LAST, c.email`,
  );
  return NextResponse.json({ customers });
}
