import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { isDaypartId } from "@/lib/config";

const BlockSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // null of leeg = hele dag blokkeren
  daypart: z
    .string()
    .refine((v) => v === "" || isDaypartId(v), "Ongeldig dagdeel.")
    .nullable()
    .optional(),
  reason: z.string().max(200).optional(),
});

/** POST /api/admin/block — voegt een handmatige blokkade toe. */
export async function POST(request: Request) {
  let data: z.infer<typeof BlockSchema>;
  try {
    data = BlockSchema.parse(await request.json());
  } catch (err) {
    const msg = err instanceof z.ZodError ? err.errors[0]?.message : "Ongeldige invoer.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Lege string of null/undefined = hele dag blokkeren.
  const daypart = data.daypart ? data.daypart : null;

  const rows = await query<{ id: string }>(
    `INSERT INTO blocks (block_date, daypart, source, reason)
     VALUES ($1, $2, 'manual', $3) RETURNING id`,
    [data.date, daypart, data.reason ?? null],
  );
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}

/** DELETE /api/admin/block?id=... — verwijdert een handmatige blokkade. */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Geen id." }, { status: 400 });
  // Alleen handmatige blokkades mogen hier weg (Google-blokkades komen via sync).
  await query(`DELETE FROM blocks WHERE id = $1 AND source = 'manual'`, [id]);
  return NextResponse.json({ ok: true });
}
