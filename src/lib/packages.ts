import { withTransaction, query } from "@/lib/db";
import { mollie, mollieAmount } from "@/lib/mollie";
import { grantCredits } from "@/lib/credits";
import { PACKAGE_BY_KEY, STUDIO, formatEuro, hoursToMinutes, type PackageKey } from "@/lib/config";

/**
 * Start de aankoop van een urenpakket: maakt een pending order aan en de
 * Mollie-betaling. De credits worden pas bijgeboekt zodra de betaling 'paid'
 * is (via de webhook) — nooit op basis van de redirect alleen.
 */
export async function createPackagePurchase(
  customerId: string,
  packageKey: PackageKey,
): Promise<{ orderId: string; checkoutUrl: string }> {
  const pkg = PACKAGE_BY_KEY[packageKey];
  if (!pkg) throw new Error("Onbekend pakket.");

  const minutes = hoursToMinutes(pkg.hours);
  const rows = await query<{ id: string }>(
    `INSERT INTO package_orders
       (customer_id, package_key, minutes, price_cents, validity_days, status)
     VALUES ($1,$2,$3,$4,$5,'pending')
     RETURNING id`,
    [customerId, pkg.key, minutes, pkg.priceCents, pkg.validityDays],
  );
  const orderId = rows[0].id;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  try {
    const payment = await mollie().payments.create({
      amount: mollieAmount(pkg.priceCents),
      description: `${STUDIO.name} — pakket ${pkg.label} (${pkg.hours} uur, ${formatEuro(pkg.priceCents)})`,
      redirectUrl: `${baseUrl}/account?order=${orderId}`,
      webhookUrl: `${baseUrl}/api/webhooks/mollie`,
      metadata: { type: "package", orderId },
    });
    await query(`UPDATE package_orders SET mollie_payment_id = $1, updated_at = now() WHERE id = $2`, [
      payment.id,
      orderId,
    ]);
    const checkoutUrl = payment.getCheckoutUrl();
    if (!checkoutUrl) throw new Error("Mollie gaf geen checkout-URL terug.");
    return { orderId, checkoutUrl };
  } catch (err) {
    await query(
      `UPDATE package_orders SET status = 'failed', updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [orderId],
    );
    throw err;
  }
}

type MollieStatus = "open" | "pending" | "authorized" | "paid" | "failed" | "expired" | "canceled";

/**
 * Verwerkt de betaalstatus van een pakket-order. Idempotent: de credits worden
 * exact één keer bijgeboekt (alleen bij de overgang pending → paid).
 */
export async function handlePackagePaymentStatus(
  molliePaymentId: string,
  status: MollieStatus,
): Promise<void> {
  if (status === "paid") {
    await withTransaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        status: string;
        customer_id: string;
        minutes: number;
        validity_days: number;
        package_key: string;
      }>(
        `SELECT id, status, customer_id, minutes, validity_days, package_key
           FROM package_orders WHERE mollie_payment_id = $1 FOR UPDATE`,
        [molliePaymentId],
      );
      const order = rows[0];
      if (!order || order.status === "paid") return; // onbekend of al verwerkt.

      await client.query(
        `UPDATE package_orders SET status = 'paid', updated_at = now() WHERE id = $1`,
        [order.id],
      );
      // Credits bijboeken binnen dezelfde transactie.
      await grantCredits(
        order.customer_id,
        order.minutes,
        {
          source: "purchase",
          packageKey: order.package_key,
          molliePaymentId,
          validityDays: order.validity_days,
          createdBy: "system",
        },
        client,
      );
    });
    return;
  }

  if (status === "failed" || status === "expired" || status === "canceled") {
    await query(
      `UPDATE package_orders SET status = $2, updated_at = now()
        WHERE mollie_payment_id = $1 AND status = 'pending'`,
      [molliePaymentId, status],
    );
  }
}
