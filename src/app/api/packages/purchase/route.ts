import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createPackagePurchase } from "@/lib/packages";
import { isPackageKey } from "@/lib/config";

const Schema = z.object({ packageKey: z.string().refine(isPackageKey, "Onbekend pakket.") });

/** POST /api/packages/purchase { packageKey } — start Mollie-betaling voor een urenpakket. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Log eerst in." }, { status: 401 });

  let packageKey: string;
  try {
    packageKey = Schema.parse(await request.json()).packageKey;
  } catch {
    return NextResponse.json({ error: "Onbekend pakket." }, { status: 400 });
  }

  try {
    const result = await createPackagePurchase(session.customerId, packageKey as never);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Pakket-aankoop mislukt:", err);
    return NextResponse.json({ error: "Kon de betaling niet starten." }, { status: 500 });
  }
}
