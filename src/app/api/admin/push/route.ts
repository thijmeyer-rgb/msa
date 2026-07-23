import { NextResponse } from "next/server";
import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  countSubscriptions,
} from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/admin/push — publieke VAPID-sleutel + aantal aangemelde apparaten. */
export async function GET() {
  try {
    // Bewust ná elkaar: twee kleine query's parallel draaien levert niets op en
    // legt alleen extra druk op de databaseverbinding.
    const publicKey = await getVapidPublicKey();
    const devices = await countSubscriptions();
    return NextResponse.json({ publicKey, devices });
  } catch (err) {
    console.error("Push-status ophalen mislukt:", err);
    return NextResponse.json({ error: "Kon meldingen-status niet laden." }, { status: 500 });
  }
}

/** POST /api/admin/push — dit apparaat aanmelden voor meldingen. */
export async function POST(request: Request) {
  let body: { subscription?: unknown; label?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400 });
  }

  const sub = body.subscription as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | undefined;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "Onvolledig abonnement." }, { status: 400 });
  }

  await saveSubscription(
    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    typeof body.label === "string" ? body.label.slice(0, 60) : undefined,
  );
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/push?endpoint=… — dit apparaat afmelden. */
export async function DELETE(request: Request) {
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "Geen endpoint." }, { status: 400 });
  await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
