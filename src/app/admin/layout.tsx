import type { Metadata, Viewport } from "next";

/**
 * Layout voor het beheer. Koppelt het PWA-manifest ALLEEN hier, zodat het
 * beheer als app op het beginscherm kan (icoon, geen browserbalk) terwijl
 * bezoekers van de boekingspagina nergens een installatie-melding krijgen.
 */
export const metadata: Metadata = {
  title: "MSA Beheer",
  manifest: "/admin.webmanifest",
  appleWebApp: {
    capable: true,
    title: "MSA Beheer",
    // "black" houdt de inhoud ónder de statusbalk. Met "black-translucent"
    // zou de kop achter de klok/batterij verdwijnen.
    statusBarStyle: "black",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
  // Next.js zet de moderne "mobile-web-app-capable" neer; oudere iOS-versies
  // (vóór 16.4, die het manifest nog niet lezen) hebben deze nog nodig om
  // zonder browserbalk te openen.
  other: { "apple-mobile-web-app-capable": "yes" },
  // Beheerpagina's horen nooit in Google te komen.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0C0C0C",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
