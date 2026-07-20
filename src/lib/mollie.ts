import createMollieClient, { type MollieClient } from "@mollie/api-client";

const globalForMollie = globalThis as unknown as { mollie?: MollieClient };

export function mollie(): MollieClient {
  if (globalForMollie.mollie) return globalForMollie.mollie;
  const apiKey = process.env.MOLLIE_API_KEY;
  if (!apiKey) throw new Error("MOLLIE_API_KEY ontbreekt.");
  const client = createMollieClient({ apiKey });
  globalForMollie.mollie = client;
  return client;
}

/** Bedrag formatteren zoals Mollie het verwacht: { currency, value: "45.00" }. */
export function mollieAmount(cents: number): { currency: "EUR"; value: string } {
  return { currency: "EUR", value: (cents / 100).toFixed(2) };
}
