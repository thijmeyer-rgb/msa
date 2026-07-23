import { NextResponse } from "next/server";
import { sendAdminPush } from "@/lib/push";

export const dynamic = "force-dynamic";

/** POST /api/admin/push/test — stuurt een testmelding naar alle apparaten. */
export async function POST() {
  const result = await sendAdminPush({
    title: "Testmelding",
    body: "Meldingen werken. Zo ziet een nieuwe boeking eruit.",
    url: "/admin",
  });
  if (result.sent === 0) {
    return NextResponse.json(
      { error: "Geen apparaat bereikt. Staan meldingen op dit apparaat wel aan?" },
      { status: 400 },
    );
  }
  return NextResponse.json(result);
}
