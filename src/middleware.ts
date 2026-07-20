import { NextResponse, type NextRequest } from "next/server";

/**
 * Beschermt /admin en /api/admin met HTTP Basic Auth.
 * Gebruikersnaam maakt niet uit; wachtwoord = ADMIN_PASSWORD.
 */
export function middleware(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;

  // Geen wachtwoord ingesteld → admin volledig dichttimmeren.
  if (!password) {
    return new NextResponse("Admin niet geconfigureerd.", { status: 503 });
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (timingSafeEqual(pass, password)) {
        return NextResponse.next();
      }
    } catch {
      /* val door naar 401 */
    }
  }

  return new NextResponse("Authenticatie vereist.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Muziekstudio Admin"' },
  });
}

/** Constante-tijd vergelijking om timing-aanvallen te voorkomen. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
