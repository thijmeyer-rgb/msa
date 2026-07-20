"use client";

import { useEffect, useState, useCallback } from "react";

interface Booking {
  id: string;
  booking_date: string;
  daypart: string;
  status: string;
  price_cents: number;
  num_people: number | null;
  paid_with_credit: boolean;
  notes: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}
interface Block {
  id: string;
  block_date: string;
  daypart: string | null;
  source: string;
  reason: string | null;
}

const DAYPART_LABEL: Record<string, string> = {
  ochtend: "Ochtend",
  middag: "Middag",
  avond: "Avond",
  latenight: "Late night",
};

function euro(cents: number): string {
  return "€" + (cents / 100).toFixed(2).replace(".", ",");
}
function dateNl(d: string): string {
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}-${m}-${y}`;
}

export default function AdminPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);

  const [blockDate, setBlockDate] = useState("");
  const [blockDaypart, setBlockDaypart] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetch("/api/admin/data", { cache: "no-store" }).then((r) => r.json());
    setBookings(data.bookings ?? []);
    setBlocks(data.blocks ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addBlock() {
    if (!blockDate) return;
    await fetch("/api/admin/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: blockDate, daypart: blockDaypart, reason: blockReason }),
    });
    setBlockDate("");
    setBlockDaypart("");
    setBlockReason("");
    load();
  }

  async function removeBlock(id: string) {
    await fetch(`/api/admin/block?id=${id}`, { method: "DELETE" });
    load();
  }

  async function cancelBooking(id: string) {
    if (!confirm("Deze boeking annuleren en het slot vrijgeven?")) return;
    await fetch("/api/admin/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: id }),
    });
    load();
  }

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>Admin</h1>
      </div>
      <p className="tagline">
        Overzicht van boekingen en blokkades. · <a href="/admin/klanten">Klanten &amp; uren →</a>
      </p>

      {/* Blokkade toevoegen */}
      <div className="card">
        <p className="step-label">Dagdeel blokkeren</p>
        <div className="form-grid">
          <div>
            <label htmlFor="bd">Datum</label>
            <input id="bd" type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="bp">Dagdeel</label>
            <select id="bp" value={blockDaypart} onChange={(e) => setBlockDaypart(e.target.value)}>
              <option value="">Hele dag</option>
              <option value="ochtend">Ochtend</option>
              <option value="middag">Middag</option>
              <option value="avond">Avond</option>
              <option value="latenight">Late night</option>
            </select>
          </div>
        </div>
        <label htmlFor="br">Reden (optioneel)</label>
        <input id="br" type="text" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
        <button className="primary" onClick={addBlock} disabled={!blockDate}>
          Blokkeren
        </button>
      </div>

      {/* Actieve blokkades */}
      {blocks.length > 0 && (
        <div className="card">
          <p className="step-label">Blokkades</p>
          {blocks.map((b) => (
            <div key={b.id} className="summary" style={{ borderTop: "1px solid var(--border)" }}>
              <span>
                {dateNl(b.block_date)} · {b.daypart ? DAYPART_LABEL[b.daypart] : "Hele dag"}
                {b.reason ? ` — ${b.reason}` : ""}
                {b.source === "google" ? " (Google Agenda)" : ""}
              </span>
              {b.source === "manual" ? (
                <button className="linkbtn" onClick={() => removeBlock(b.id)}>
                  verwijderen
                </button>
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>
                  via sync
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Boekingen */}
      <div className="card">
        <p className="step-label">Aankomende boekingen</p>
        {loading ? (
          <p className="muted">
            <span className="spinner" /> &nbsp;Laden…
          </p>
        ) : bookings.length === 0 ? (
          <p className="muted">Nog geen aankomende boekingen.</p>
        ) : (
          bookings.map((b) => (
            <div
              key={b.id}
              style={{
                padding: "14px 0",
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <strong>
                  {dateNl(b.booking_date)} · {DAYPART_LABEL[b.daypart]}
                </strong>
                <div className="muted" style={{ fontSize: 14 }}>
                  {b.customer_name} · {b.customer_email} · {b.customer_phone}
                  {b.num_people ? ` · ${b.num_people} pers.` : ""}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {b.status === "pending" ? "⏳ wacht op betaling" : "✅ betaald"} ·{" "}
                  {b.paid_with_credit ? "met tegoed" : euro(b.price_cents)}
                  {b.notes ? ` · ⚠️ ${b.notes}` : ""}
                </div>
              </div>
              <button className="linkbtn" onClick={() => cancelBooking(b.id)}>
                annuleren
              </button>
            </div>
          ))
        )}
      </div>

      <p className="footer-note">
        Terugbetalingen verlopen via je Mollie-dashboard. Annuleren hier geeft alleen het slot vrij.
      </p>
    </div>
  );
}
