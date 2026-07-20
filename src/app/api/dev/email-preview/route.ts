import { NextResponse } from "next/server";
import { previewConfirmationHtml, previewLoginHtml } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * Dev-hulproute: toont hoe de e-mails eruitzien.
 *   /api/dev/email-preview            → bevestigingsmail
 *   /api/dev/email-preview?type=login → login-mail
 * Alleen beschikbaar buiten productie.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Niet beschikbaar." }, { status: 404 });
  }
  const type = new URL(request.url).searchParams.get("type");
  const html = type === "login" ? previewLoginHtml() : previewConfirmationHtml();
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
