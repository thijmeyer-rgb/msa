import { NextResponse } from "next/server";
import { z } from "zod";
import { query, isUniqueViolation } from "@/lib/db";
import { normalizeCode } from "@/lib/discounts";

export const dynamic = "force-dynamic";

/** GET /api/admin/discounts — alle kortingscodes met gebruik. */
export async function GET() {
  const codes = await query(
    `SELECT id, code, type, value, max_uses, used_count, expires_at,
            new_customers_only, active, auto_generated, created_at
       FROM discount_codes ORDER BY created_at DESC`,
  );
  return NextResponse.json({ codes });
}

const CreateSchema = z.object({
  code: z.string().trim().min(2).max(40),
  type: z.enum(["percent", "fixed"]),
  value: z.coerce.number().positive(),
  maxUses: z.coerce.number().int().positive().optional(),
  expiresAt: z.string().optional(), // YYYY-MM-DD
  newCustomersOnly: z.boolean().optional(),
});

/** POST /api/admin/discounts — nieuwe kortingscode aanmaken. */
export async function POST(request: Request) {
  let data: z.infer<typeof CreateSchema>;
  try {
    data = CreateSchema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors[0]?.message : "Ongeldige invoer.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Percent: 1-100. Fixed: euro's → centen.
  const value = data.type === "percent" ? Math.min(100, Math.round(data.value)) : Math.round(data.value * 100);
  const expiresAt = data.expiresAt ? new Date(data.expiresAt + "T23:59:59") : null;

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO discount_codes (code, type, value, max_uses, expires_at, new_customers_only)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [normalizeCode(data.code), data.type, value, data.maxUses ?? null, expiresAt, data.newCustomersOnly ?? false],
    );
    return NextResponse.json({ id: rows[0].id }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: "Deze code bestaat al." }, { status: 409 });
    }
    throw err;
  }
}

/** DELETE /api/admin/discounts?id=... — code verwijderen. */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Geen id." }, { status: 400 });
  // Verwijderen mag alleen als de code nog nergens aan een boeking hangt;
  // anders deactiveren we hem (behoud referentie-integriteit).
  const used = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bookings WHERE discount_code_id = $1`,
    [id],
  );
  if ((used[0]?.n ?? 0) > 0) {
    await query(`UPDATE discount_codes SET active = false WHERE id = $1`, [id]);
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await query(`DELETE FROM discount_codes WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
