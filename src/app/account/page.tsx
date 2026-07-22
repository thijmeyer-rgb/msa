"use client";

import { useEffect, useState, useCallback } from "react";

const PACKAGES = [
  { key: "basis", label: "Basis", hours: 8, price: "€95,00" },
  { key: "pro", label: "Pro", hours: 16, price: "€175,00" },
  { key: "premium", label: "Premium", hours: 32, price: "€299,00" },
];

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return (Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",")) + " uur";
}
function euro(cents: number): string {
  return "€" + (cents / 100).toFixed(2).replace(".", ",");
}
function dateNl(d: string): string {
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}-${m}-${y}`;
}

interface Me {
  profile: { name: string; email: string; phone: string };
  balanceMinutes: number;
  batches: { id: string; minutes_remaining: number; expires_at: string | null; source: string; package_key: string | null }[];
  bookings: { id: string; booking_date: string; daypart: string | null; slot_label: string; status: string; price_cents: number; paid_with_credit: boolean }[];
}

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauth, setUnauth] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/account/me", { cache: "no-store" });
    if (res.status === 401) {
      setUnauth(true);
      setLoading(false);
      return;
    }
    const data: Me = await res.json();
    setMe(data);
    setName(data.profile.name ?? "");
    setPhone(data.profile.phone ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (unauth) window.location.href = "/account/login";
  }, [unauth]);

  async function saveProfile() {
    const res = await fetch("/api/account/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
    });
    setSavedMsg(res.ok ? "Opgeslagen ✓" : "Kon niet opslaan");
    setTimeout(() => setSavedMsg(""), 2500);
  }

  async function buy(packageKey: string) {
    const res = await fetch("/api/packages/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageKey }),
    });
    const data = await res.json();
    if (res.ok) window.location.href = data.checkoutUrl;
    else alert(data.error ?? "Er ging iets mis.");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (loading) {
    return (
      <div className="wrap">
        <p className="muted">
          <span className="spinner" /> &nbsp;Laden…
        </p>
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="logo-mark">MSA</span>
          <h1>Mijn account</h1>
        </div>
        <button className="account-btn" onClick={logout}>
          Uitloggen
        </button>
      </div>
      <p className="tagline">{me.profile.email}</p>

      {/* Saldo */}
      <div className="card center">
        <p className="step-label">Uren-tegoed</p>
        <div className="big-number">{fmtHours(me.balanceMinutes)}</div>
        {me.balanceMinutes > 0 && (
          <a href="/" className="primary" style={{ display: "inline-block", textDecoration: "none", padding: "12px 22px", marginTop: 12 }}>
            Boek met tegoed
          </a>
        )}
      </div>

      {/* Batches met vervaldatum */}
      {me.batches.length > 0 && (
        <div className="card">
          <p className="step-label">Je tegoed vervalt als volgt</p>
          {me.batches.map((b) => (
            <div key={b.id} className="summary" style={{ borderTop: "1px solid var(--border)" }}>
              <span>
                {fmtHours(b.minutes_remaining)}
                {b.package_key ? ` · pakket ${b.package_key}` : b.source === "refund" ? " · teruggeboekt" : ""}
              </span>
              <span className="muted">{b.expires_at ? `vervalt ${dateNl(b.expires_at)}` : "geen vervaldatum"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pakketten kopen */}
      <div className="card">
        <p className="step-label">Urenpakket kopen</p>
        <div className="slots">
          {PACKAGES.map((p) => (
            <div key={p.key} className="slot static">
              <span className="meta">
                <span className="label">{p.label}</span>
                <span className="time">{p.hours} uur studiotijd</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="price">{p.price}</span>
                <button
                  className="primary"
                  style={{ width: "auto", margin: 0, padding: "10px 16px", fontSize: 15 }}
                  onClick={() => buy(p.key)}
                >
                  Kopen
                </button>
              </span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          Gekochte uren zijn 90 dagen geldig en stapelen op je bestaande tegoed.
        </p>
      </div>

      {/* Profiel */}
      <div className="card">
        <p className="step-label">Gegevens</p>
        <label htmlFor="n">Naam</label>
        <input id="n" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="p">Telefoonnummer</label>
        <input id="p" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="primary" onClick={saveProfile}>
          Opslaan
        </button>
        {savedMsg && <p className="muted" style={{ marginTop: 8 }}>{savedMsg}</p>}
      </div>

      {/* Boekingen */}
      <div className="card">
        <p className="step-label">Mijn boekingen</p>
        {me.bookings.length === 0 ? (
          <p className="muted">Nog geen boekingen.</p>
        ) : (
          me.bookings.map((b) => (
            <div key={b.id} className="summary" style={{ borderTop: "1px solid var(--border)" }}>
              <span>
                {dateNl(b.booking_date)} · {b.slot_label}
              </span>
              <span className="muted">
                {b.status === "pending" ? "wacht op betaling" : b.paid_with_credit ? "met tegoed" : euro(b.price_cents)}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="footer-note">
        <a href="/">← Nieuwe boeking</a>
      </p>
    </div>
  );
}
