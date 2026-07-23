"use client";

import { useCallback, useEffect, useState } from "react";

interface Calendar {
  id: string;
  summary: string;
  primary: boolean;
}
interface Status {
  configured: boolean;
  connected: boolean;
  email: string;
  calendarId: string;
  redirectUri: string;
  calendars: Calendar[];
}

export default function GoogleCalendarCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCal, setSavingCal] = useState(false);
  const [msg, setMsg] = useState("");

  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/google/status", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus(await res.json());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Toon melding na terugkeer van Google (?google=connected|error).
    const p = new URLSearchParams(window.location.search);
    const g = p.get("google");
    if (g === "connected") setMsg("Google Agenda gekoppeld ✓");
    else if (g === "error") setMsg("Koppelen mislukt — probeer opnieuw.");
    if (g) window.history.replaceState({}, "", "/admin/instellingen");
  }, [load]);

  async function chooseCalendar(calendarId: string) {
    setSavingCal(true);
    await fetch("/api/admin/google/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId }),
    });
    await load();
    setSavingCal(false);
    setMsg("Agenda-keuze opgeslagen ✓");
    setTimeout(() => setMsg(""), 2500);
  }

  async function disconnect() {
    if (!confirm("Google Agenda ontkoppelen? Nieuwe boekingen komen dan niet meer in je agenda.")) return;
    await fetch("/api/admin/google/disconnect", { method: "POST" });
    await load();
    setMsg("Ontkoppeld.");
    setTimeout(() => setMsg(""), 2500);
  }

  return (
    <div className="card">
      <p className="step-label">Google Agenda</p>

      {loading ? (
        <p className="muted">
          <span className="spinner" /> &nbsp;Laden…
        </p>
      ) : loadError ? (
        <>
          <p className="error">Kon de status niet laden.</p>
          <button className="secondary" onClick={load}>
            Opnieuw proberen
          </button>
        </>
      ) : !status?.configured ? (
        <>
          <p className="muted" style={{ fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
            Koppel je Google Agenda zodat elke betaalde boeking er automatisch in verschijnt. Eenmalig
            instellen (±5 min): zet in Google Cloud een OAuth-client op en vul{" "}
            <code>GOOGLE_OAUTH_CLIENT_ID</code> en <code>GOOGLE_OAUTH_CLIENT_SECRET</code> in Vercel in.
            Gebruik als “Authorized redirect URI” exact:
          </p>
          <p style={{ wordBreak: "break-all", fontSize: 13, marginTop: 8 }}>
            <code>{status?.redirectUri || "(stel eerst NEXT_PUBLIC_BASE_URL in)"}</code>
          </p>
          <p className="muted" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0, marginTop: 8 }}>
            Zodra dat staat, verschijnt hier de koppelknop.
          </p>
        </>
      ) : status.connected ? (
        <>
          <p className="muted" style={{ fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
            Gekoppeld{status.email ? ` met ${status.email}` : ""}. Betaalde boekingen (dagdeel én flexibel)
            komen automatisch in de gekozen agenda; bij annuleren verdwijnen ze weer.
          </p>

          <label htmlFor="cal" style={{ marginTop: 14 }}>
            Agenda voor boekingen
          </label>
          <select
            id="cal"
            value={status.calendarId}
            disabled={savingCal}
            onChange={(e) => chooseCalendar(e.target.value)}
          >
            {/* Zorg dat de huidige waarde altijd zichtbaar is, ook als de lijst leeg is. */}
            {status.calendars.length === 0 && (
              <option value={status.calendarId}>
                {status.calendarId === "primary" ? "Hoofdagenda" : status.calendarId}
              </option>
            )}
            {status.calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (hoofdagenda)" : ""}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <a className="primary" href="/api/admin/google/connect" style={{ margin: 0, textDecoration: "none" }}>
              Opnieuw koppelen
            </a>
            <button className="secondary" style={{ margin: 0 }} onClick={disconnect}>
              Ontkoppelen
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
            Klik hieronder, log in met je Google-account en geef toestemming. Daarna komt elke betaalde
            boeking automatisch in je agenda.
          </p>
          <a className="primary" href="/api/admin/google/connect" style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}>
            Koppel Google Agenda
          </a>
        </>
      )}

      {msg && (
        <p className="muted" style={{ marginTop: 12 }}>
          {msg}
        </p>
      )}
    </div>
  );
}
