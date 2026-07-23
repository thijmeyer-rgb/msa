import { NextResponse } from "next/server";
import {
  getNukiToken,
  getNukiConfig,
  listSmartlocks,
  saveNukiToken,
  saveNukiSmartlock,
  clearNukiConfig,
} from "@/lib/nuki";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/nuki — status: is er een token, welk slot is gekozen, en
 * welke sloten heeft dit account? Het token zelf wordt NOOIT teruggegeven.
 */
export async function GET() {
  const token = await getNukiToken();
  const cfg = await getNukiConfig();
  const smartlocks = token ? await listSmartlocks(token) : [];
  return NextResponse.json({
    hasToken: Boolean(token),
    smartlockId: cfg?.smartlockId ?? "",
    configured: Boolean(cfg),
    smartlocks,
    tokenValid: token ? smartlocks.length > 0 : null,
  });
}

/** POST /api/admin/nuki — token en/of gekozen slot opslaan. */
export async function POST(request: Request) {
  let body: { token?: unknown; smartlockId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ongeldige invoer." }, { status: 400 });
  }

  if (typeof body.token === "string" && body.token.trim()) {
    await saveNukiToken(body.token.trim());
  }
  if (typeof body.smartlockId === "string") {
    await saveNukiSmartlock(body.smartlockId.trim());
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/nuki — token en slot wissen (uitzetten). */
export async function DELETE() {
  await clearNukiConfig();
  return NextResponse.json({ ok: true });
}
