import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, verifyAdminToken } from "@/lib/admin-session";

/**
 * Beschermt /admin en /api/admin met een ondertekende sessiecookie.
 * Inloggen gebeurt op /admin/login (wachtwoord = ADMIN_PASSWORD).
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Login-pagina en login-endpoint zijn uiteraard zonder sessie bereikbaar.
  if (pathname === "/admin/login" || pathname === "/api/admin/auth") {
    return NextResponse.next();
  }

  // Geen wachtwoord ingesteld → admin volledig dichttimmeren.
  if (!process.env.ADMIN_PASSWORD) {
    return new NextResponse("Admin niet geconfigureerd.", { status: 503 });
  }

  if (await verifyAdminToken(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // API-verzoeken krijgen een nette 401; pagina's gaan naar het login-scherm.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }
  const loginUrl = new URL("/admin/login", request.url);
  if (pathname !== "/admin") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
