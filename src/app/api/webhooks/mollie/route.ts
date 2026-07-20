import { NextResponse } from "next/server";
import { mollie } from "@/lib/mollie";
import { handlePaymentStatus } from "@/lib/bookings";
import { handlePackagePaymentStatus } from "@/lib/packages";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/mollie
 *
 * Mollie stuurt hier alleen een payment-id (form-encoded: id=tr_xxx). We halen
 * ZELF de actuele status op bij Mollie — de payload nooit vertrouwen.
 *
 * Idempotent: Mollie kan dezelfde webhook meerdere keren sturen; de
 * statusovergangen in handlePaymentStatus zijn voorwaardelijk, dus herhaling
 * verandert niets extra's (en de mail gaat maar één keer).
 *
 * Retourneert 200 bij succes. Bij een onverwachte fout geven we 500 zodat
 * Mollie het later opnieuw probeert.
 */
export async function POST(request: Request) {
  let paymentId: string | null = null;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      paymentId = body.id ?? null;
    } else {
      const form = await request.formData();
      paymentId = (form.get("id") as string) ?? null;
    }
  } catch {
    return NextResponse.json({ error: "Kon payload niet lezen." }, { status: 400 });
  }

  if (!paymentId) {
    return NextResponse.json({ error: "Geen payment-id ontvangen." }, { status: 400 });
  }

  try {
    const payment = await mollie().payments.get(paymentId);
    // Routeer op basis van het type in de metadata: boeking of pakket-aankoop.
    const type = (payment.metadata as { type?: string } | null)?.type;
    if (type === "package") {
      await handlePackagePaymentStatus(payment.id, payment.status as never);
    } else {
      await handlePaymentStatus(payment.id, payment.status as never);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`Webhook-fout voor payment ${paymentId}:`, err);
    // 500 → Mollie probeert het opnieuw.
    return NextResponse.json({ error: "Verwerking mislukt." }, { status: 500 });
  }
}
