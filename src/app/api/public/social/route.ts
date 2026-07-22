import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** GET /api/public/social — publieke social-proof (reviewscore + aantal). */
export async function GET() {
  try {
    const s = await getSettings(["review_rating", "review_count"]);
    return NextResponse.json({ rating: s.review_rating ?? "", count: s.review_count ?? "" });
  } catch {
    return NextResponse.json({ rating: "", count: "" });
  }
}
