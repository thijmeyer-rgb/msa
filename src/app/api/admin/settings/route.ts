import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, setSetting, TRACKING_KEYS } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** GET /api/admin/settings — huidige tracking-instellingen. */
export async function GET() {
  const s = await getSettings([...TRACKING_KEYS]);
  return NextResponse.json({ gaId: s.ga_id ?? "", metaPixelId: s.meta_pixel_id ?? "" });
}

const Schema = z.object({
  gaId: z.string().trim().max(40),
  metaPixelId: z.string().trim().max(40),
});

/** POST /api/admin/settings — tracking-IDs opslaan. */
export async function POST(request: Request) {
  let data: z.infer<typeof Schema>;
  try {
    data = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400 });
  }
  await setSetting("ga_id", data.gaId);
  await setSetting("meta_pixel_id", data.metaPixelId);
  return NextResponse.json({ ok: true });
}
