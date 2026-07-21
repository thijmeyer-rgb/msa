import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/tracking — publieke tracking-IDs (GA + Meta Pixel).
 * Deze IDs zijn niet geheim (ze staan sowieso in de client). De scripts
 * worden pas geladen na cookie-toestemming (zie Tracking-component).
 */
export async function GET() {
  try {
    const s = await getSettings(["ga_id", "meta_pixel_id"]);
    return NextResponse.json({ gaId: s.ga_id ?? "", metaPixelId: s.meta_pixel_id ?? "" });
  } catch {
    return NextResponse.json({ gaId: "", metaPixelId: "" });
  }
}
