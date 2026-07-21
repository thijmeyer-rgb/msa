import type { Metadata } from "next";
import { Anton, Archivo } from "next/font/google";
import "./globals.css";
import Tracking from "@/components/Tracking";

// Merk-fonts van muziekstudioalkmaar.nl: Anton (zware display-koppen) + Archivo (body).
const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});
const archivo = Archivo({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Studiotijd boeken — Muziekstudio Alkmaar",
  description:
    "Boek eenvoudig een dagdeel in Muziekstudio Alkmaar. Plug & play: kom binnen en neem direct op.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${anton.variable} ${archivo.variable}`}>
      <body>
        <div className="grain" aria-hidden="true" />
        {children}
        <Tracking />
      </body>
    </html>
  );
}
