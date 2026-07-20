"use client";

import { use, useEffect, useState } from "react";
import { CheckIcon, WarnIcon, QuestionIcon } from "@/components/icons";

interface StatusData {
  status: string;
  date: string;
  label: string;
  start: string;
  end: string;
  priceCents: number;
}

function euro(cents: number): string {
  return "€" + (cents / 100).toFixed(2).replace(".", ",");
}
function dateNl(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}-${m}-${y}`;
}

export default function BookingStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<StatusData | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Aantal pogingen zolang de status nog 'pending' is (webhook is async).
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/bookings/${id}/status`, { cache: "no-store" });
        if (res.status === 404) {
          if (active) setNotFound(true);
          return;
        }
        const d: StatusData = await res.json();
        if (!active) return;
        setData(d);
        // Blijf pollen zolang de betaling nog niet verwerkt is.
        if (d.status === "pending" && waited < 20) {
          timer = setTimeout(() => setWaited((w) => w + 1), 1500);
        }
      } catch {
        if (active) timer = setTimeout(() => setWaited((w) => w + 1), 2000);
      }
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, waited]);

  return (
    <div className="wrap">
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>Muziekstudio Alkmaar</h1>
      </div>

      <div className="card center">
        {notFound ? (
          <>
            <div className="status-icon warn"><QuestionIcon /></div>
            <h2>Boeking niet gevonden</h2>
            <p className="muted">Controleer de link of neem contact met ons op.</p>
          </>
        ) : !data ? (
          <p className="muted">
            <span className="spinner" /> &nbsp;Laden…
          </p>
        ) : data.status === "paid" ? (
          <>
            <div className="status-icon ok"><CheckIcon /></div>
            <h2>Boeking bevestigd!</h2>
            <p>
              {data.label} · {data.start}–{data.end}
              <br />
              {dateNl(data.date)} · {euro(data.priceCents)}
            </p>
            <p className="muted">
              We hebben een bevestiging met binnenkomst-instructies naar je e-mail gestuurd.
              Tot dan!
            </p>
          </>
        ) : data.status === "pending" ? (
          <>
            <div className="status-icon">
              <span className="spinner" />
            </div>
            <h2>Betaling verwerken</h2>
            <p className="muted">
              Een moment — we bevestigen je betaling. Deze pagina ververst automatisch.
            </p>
            {waited >= 20 && (
              <p className="muted">
                Duurt het lang? Je ontvangt sowieso een e-mail zodra de betaling rond is.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="status-icon warn"><WarnIcon /></div>
            <h2>Betaling niet voltooid</h2>
            <p className="muted">
              Er is niet betaald, dus het dagdeel is weer vrijgegeven. Je kunt opnieuw proberen
              te boeken.
            </p>
            <a href="/" className="primary" style={{ display: "inline-block", textDecoration: "none", padding: "12px 20px", marginTop: 16 }}>
              Opnieuw boeken
            </a>
          </>
        )}
      </div>

      <p className="footer-note">
        Vragen? Bel of{" "}
        <a href="https://wa.me/31683503422" target="_blank" rel="noopener noreferrer">
          app via WhatsApp
        </a>{" "}
        · info@muziekstudioalkmaar.nl
      </p>
    </div>
  );
}
