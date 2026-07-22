"use client";

import { use, useEffect, useState, useCallback } from "react";

function fmtHours(m: number) {
  const h = m / 60;
  return (Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",")) + " uur";
}
function euro(c: number) {
  return "€" + (c / 100).toFixed(2).replace(".", ",");
}
function dateNl(d: string) {
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}-${m}-${y}`;
}

interface Detail {
  profile: { name: string; email: string; phone: string };
  balanceMinutes: number;
  batches: { id: string; minutes_remaining: number; expires_at: string | null; source: string; package_key: string | null; note: string | null }[];
  bookings: { id: string; booking_date: string; daypart: string | null; slot_label: string; status: string; price_cents: number; paid_with_credit: boolean }[];
  orders: { id: string; package_key: string; minutes: number; price_cents: number; status: string; created_at: string }[];
}

export default function AdminCustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [validity, setValidity] = useState("90");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/customers/${id}`, { cache: "no-store" });
    setD(await res.json());
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function adjust(action: "grant" | "revoke") {
    const h = Number(hours);
    if (!h || h <= 0) return;
    setBusy(true);
    await fetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action, customerId: id, hours: h,
        note: note || undefined,
        validityDays: action === "grant" ? Number(validity) : undefined,
      }),
    });
    setHours(""); setNote(""); setBusy(false);
    load();
  }

  async function removeCustomer() {
    if (
      !confirm(
        "Deze klant volledig verwijderen? Ook de boekingshistorie, het uren-tegoed en pakket-orders worden gewist. Dit kan niet ongedaan worden gemaakt.",
      )
    )
      return;
    setBusy(true);
    const res = await fetch(`/api/admin/customers/${id}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/admin/klanten";
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    alert(data.error ?? "Verwijderen mislukt.");
    setBusy(false);
  }

  if (!d || !d.profile) {
    return <div className="wrap"><p className="muted"><span className="spinner" /> &nbsp;Laden…</p></div>;
  }

  return (
    <div className="wrap" style={{ maxWidth: 720 }}>
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>{d.profile.name || "(geen naam)"}</h1>
      </div>
      <p className="tagline">
        <a href="/admin/klanten">← Alle klanten</a> · {d.profile.email}
        {d.profile.phone ? ` · ${d.profile.phone}` : ""}
      </p>

      <div className="card center">
        <p className="step-label">Huidig tegoed</p>
        <div className="big-number" style={{ fontSize: 40 }}>{fmtHours(d.balanceMinutes)}</div>
      </div>

      {/* Uren beheren */}
      <div className="card">
        <p className="step-label">Uren toekennen of intrekken</p>
        <div className="form-grid">
          <div>
            <label htmlFor="h">Aantal uren</label>
            <input id="h" type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div>
            <label htmlFor="v">Geldig (dagen, 0 = nooit)</label>
            <input id="v" type="number" min={0} value={validity} onChange={(e) => setValidity(e.target.value)} />
          </div>
        </div>
        <label htmlFor="note">Notitie (optioneel)</label>
        <input id="note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="primary" style={{ margin: 0 }} disabled={busy} onClick={() => adjust("grant")}>
            + Uren toekennen
          </button>
          <button className="secondary" style={{ margin: 0 }} disabled={busy} onClick={() => adjust("revoke")}>
            − Uren intrekken
          </button>
        </div>
      </div>

      {/* Batches */}
      {d.batches.length > 0 && (
        <div className="card">
          <p className="step-label">Tegoed-batches</p>
          {d.batches.map((b) => (
            <div key={b.id} className="summary" style={{ borderTop: "1px solid var(--border)" }}>
              <span>
                {fmtHours(b.minutes_remaining)} · {b.source}
                {b.package_key ? ` (${b.package_key})` : ""}
                {b.note ? ` — ${b.note}` : ""}
              </span>
              <span className="muted">{b.expires_at ? `vervalt ${dateNl(b.expires_at)}` : "geen verval"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Boekingen */}
      <div className="card">
        <p className="step-label">Boekingen</p>
        {d.bookings.length === 0 ? (
          <p className="muted">Geen boekingen.</p>
        ) : (
          d.bookings.map((b) => (
            <div key={b.id} className="summary" style={{ borderTop: "1px solid var(--border)" }}>
              <span>{dateNl(b.booking_date)} · {b.slot_label}</span>
              <span className="muted">
                {b.status} · {b.paid_with_credit ? "tegoed" : euro(b.price_cents)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Verwijderen */}
      <div className="card">
        <p className="step-label">Klant verwijderen</p>
        <p className="muted" style={{ fontSize: 14 }}>
          Verwijdert de klant met alle historie. Kan alleen als er geen actieve of toekomstige
          boeking meer is.
        </p>
        <button className="secondary" style={{ marginTop: 12 }} disabled={busy} onClick={removeCustomer}>
          Klant definitief verwijderen
        </button>
      </div>
    </div>
  );
}
