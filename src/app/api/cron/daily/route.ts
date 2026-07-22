import { NextResponse } from "next/server";
import { expireStalePendingBookings } from "@/lib/bookings";
import { sendDueReminders, sendDueRecoveries, sendDueReviewRequests } from "@/lib/automations";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dagelijkse cron: ruimt verlopen reserveringen op, stuurt sessie-herinneringen
 * (morgen) en verlaten-boeking-mails. Beveiligd met CRON_SECRET.
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
  const reminders = await sendDueReminders();
  const recoveries = await sendDueRecoveries();
  const reviewRequests = await sendDueReviewRequests();

  return NextResponse.json({ expired, reminders, recoveries, reviewRequests });
}

export const GET = handle;
export const POST = handle;
