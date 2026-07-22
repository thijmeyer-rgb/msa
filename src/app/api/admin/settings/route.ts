import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const KEYS = ["ga_id", "meta_pixel_id", "review_rating", "review_count", "review_url", "review_reward_cents"];

/** GET /api/admin/settings — tracking + social proof + review-instellingen. */
export async function GET() {
  const s = await getSettings(KEYS);
  return NextResponse.json({
    gaId: s.ga_id ?? "",
    metaPixelId: s.meta_pixel_id ?? "",
    reviewRating: s.review_rating ?? "",
    reviewCount: s.review_count ?? "",
    reviewUrl: s.review_url ?? "",
    reviewReward: s.review_reward_cents ? (parseInt(s.review_reward_cents, 10) / 100).toString() : "",
  });
}

const Schema = z.object({
  gaId: z.string().trim().max(40),
  metaPixelId: z.string().trim().max(40),
  reviewRating: z.string().trim().max(10),
  reviewCount: z.string().trim().max(20),
  reviewUrl: z.string().trim().max(300),
  reviewReward: z.string().trim().max(10),
});

/** POST /api/admin/settings — opslaan. */
export async function POST(request: Request) {
  let data: z.infer<typeof Schema>;
  try {
    data = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400 });
  }
  await setSetting("ga_id", data.gaId);
  await setSetting("meta_pixel_id", data.metaPixelId);
  await setSetting("review_rating", data.reviewRating);
  await setSetting("review_count", data.reviewCount);
  await setSetting("review_url", data.reviewUrl);
  const cents = data.reviewReward ? String(Math.round(parseFloat(data.reviewReward.replace(",", ".")) * 100)) : "";
  await setSetting("review_reward_cents", cents);
  return NextResponse.json({ ok: true });
}
