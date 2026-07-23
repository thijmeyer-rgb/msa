/**
 * Push-meldingen voor de beheer-app: een seintje op de telefoon zodra er een
 * boeking betaald is, zonder dat je je mail hoeft te openen.
 *
 * ── HOE HET WERKT ─────────────────────────────────────────────────────────
 * Web Push heeft een sleutelpaar (VAPID) nodig waarmee de server zich
 * identificeert bij de pushdienst van Apple/Google. Die sleutels maken we
 * automatisch aan bij het eerste gebruik en bewaren we in site_settings —
 * je hoeft dus niets in te stellen in Vercel.
 *
 * Per apparaat waarop je meldingen aanzet komt er een rij in
 * push_subscriptions. Verlopen abonnementen ruimen we vanzelf op.
 *
 * ── LET OP (iOS) ──────────────────────────────────────────────────────────
 * Op een iPhone werkt Web Push ALLEEN als de webapp op het beginscherm is
 * gezet (iOS 16.4+). In Safari zelf krijg je geen meldingen.
 */

import webpush from "web-push";
import { query } from "@/lib/db";
import { getSettings, setSetting } from "@/lib/settings";
import { STUDIO } from "@/lib/config";

const PUBLIC_KEY = "vapid_public_key";
const PRIVATE_KEY = "vapid_private_key";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Haalt de VAPID-sleutels op, of maakt ze aan als ze er nog niet zijn.
 * De sleutels horen bij dit domein: gooi je ze weg, dan moeten alle
 * apparaten de meldingen opnieuw aanzetten.
 */
export async function getOrCreateVapidKeys(): Promise<VapidKeys> {
  const s = await getSettings([PUBLIC_KEY, PRIVATE_KEY]);
  if (s[PUBLIC_KEY] && s[PRIVATE_KEY]) {
    return { publicKey: s[PUBLIC_KEY], privateKey: s[PRIVATE_KEY] };
  }
  const keys = webpush.generateVAPIDKeys();
  await setSetting(PUBLIC_KEY, keys.publicKey);
  await setSetting(PRIVATE_KEY, keys.privateKey);
  return keys;
}

/** Alleen de publieke sleutel — die mag de browser weten. */
export async function getVapidPublicKey(): Promise<string> {
  return (await getOrCreateVapidKeys()).publicKey;
}

async function configure(): Promise<void> {
  const { publicKey, privateKey } = await getOrCreateVapidKeys();
  webpush.setVapidDetails(`mailto:${STUDIO.email}`, publicKey, privateKey);
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Slaat een abonnement op (of ververst een bestaand met dezelfde endpoint). */
export async function saveSubscription(sub: PushSubscriptionInput, label?: string): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = EXCLUDED.label`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, label ?? null],
  );
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function countSubscriptions(): Promise<number> {
  const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM push_subscriptions`);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Stuurt een melding naar alle aangemelde apparaten. Non-fataal: een boeking
 * mag nooit mislukken omdat een melding niet aankwam. Abonnementen die de
 * pushdienst als verlopen markeert (404/410) worden opgeruimd.
 */
export async function sendAdminPush(opts: {
  title: string;
  body: string;
  url?: string;
}): Promise<{ sent: number; removed: number }> {
  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions`,
  );
  if (subs.length === 0) return { sent: 0, removed: 0 };

  await configure();
  const payload = JSON.stringify({
    title: opts.title,
    body: opts.body,
    url: opts.url ?? "/admin",
  });

  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
      await query(`UPDATE push_subscriptions SET last_success_at = now() WHERE endpoint = $1`, [
        s.endpoint,
      ]);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Apparaat heeft de melding-toestemming ingetrokken of de app verwijderd.
        await removeSubscription(s.endpoint);
        removed++;
      } else {
        console.error("Push versturen mislukt:", err);
      }
    }
  }
  return { sent, removed };
}
