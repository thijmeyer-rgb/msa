import { query } from "@/lib/db";

/** Haalt meerdere instellingen op als key→value map. */
export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const rows = await query<{ key: string; value: string | null }>(
    `SELECT key, value FROM site_settings WHERE key = ANY($1)`,
    [keys],
  );
  const out: Record<string, string> = {};
  for (const r of rows) if (r.value) out[r.key] = r.value;
  return out;
}

/** Slaat een instelling op (upsert). Lege waarde wist de instelling effectief. */
export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value.trim()],
  );
}

export const TRACKING_KEYS = ["ga_id", "meta_pixel_id"] as const;
