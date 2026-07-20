import { NextResponse } from "next/server";
import { expireStalePendingBookings } from "@/lib/bookings";

export const dynamic = "force-dynamic";

/**
 * Cron-endpoint: geeft verlopen 'pending' boekingen vrij.
 * Draait op Vercel Cron (zie vercel.json), maar ook handmatig aanroepbaar.
 *
 * Beveiliging: vereist de header `Authorization: Bearer <CRON_SECRET>`.
 * Vercel Cron stuurt deze header automatisch mee als CRON_SECRET is gezet.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Niet geautoriseerd." }, { status: 401 });
    }
  }

  const expired = await expireStalePendingBookings();
  return NextResponse.json({ expired });
}

export const GET = handle;
export const POST = handle;
