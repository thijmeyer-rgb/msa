"use client";

import { useCallback, useEffect, useState } from "react";

interface Smartlock {
  smartlockId: string;
  name: string;
}
interface Status {
  hasToken: boolean;
  smartlockId: string;
  configured: boolean;
  smartlocks: Smartlock[];
  tokenValid: boolean | null;
}

export default function NukiCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [testPin, setTestPin] = useState("");
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/nuki", { cache: "no-store" });
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
  }, [load]);

  async function saveToken() {
    if (!token.trim()) return;
    setBusy(true);
    setMsg("");
    await fetch("/api/admin/nuki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
    setToken("");
    await load();
    setBusy(false);
    setMsg("Token opgeslagen ✓");
  }

  async function chooseLock(smartlockId: string) {
    setBusy(true);
    await fetch("/api/admin/nuki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smartlockId }),
    });
    await load();
    setBusy(false);
    setMsg("Slot gekozen ✓");
  }

  async function runTest() {
    setBusy(true);
    setMsg("");
    setTestPin("");
    const res = await fetch("/api/admin/nuki/test", { method: "POST" });
    const data = (await res.json()) as { pin?: string; error?: string };
    if (res.ok && data.pin) setTestPin(data.pin);
    else setMsg(data.error ?? "Testcode aanmaken mislukt.");
    setBusy(false);
  }

  async function turnOff() {
    if (!confirm("Nuki-deurcodes uitzetten? Klanten krijgen dan weer de standaard deurinstructie.")) return;
    setBusy(true);
    await fetch("/api/admin/nuki", { method: "DELETE" });
    setTestPin("");
    await load();
    setBusy(false);
    setMsg("Uitgezet.");
  }

  return (
    <div className="card">
      <p className="step-label">Nuki deurcodes</p>

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
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
            Elke betaalde boeking krijgt automatisch een eigen 6-cijferige deurcode, geldig van 15
            minuten vóór tot 15 minuten ná de sessie. De code staat in de bevestigingsmail.
          </p>

          {!status?.hasToken ? (
            <>
              <label htmlFor="nuki-token" style={{ marginTop: 14 }}>
                Nuki Web API-token
              </label>
              <input
                id="nuki-token"
                type="password"
                value={token}
                placeholder="Plak hier je token"
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="muted" style={{ fontSize: 13, textTransform: "none", letterSpacing: 0, marginTop: 6 }}>
                Maak een token aan op web.nuki.io → Menu → API → “Generate API token”, met de rechten
                voor het beheren van autorisaties. Het token wordt alleen op de server bewaard en
                daarna nooit meer getoond — ook niet aan dit scherm.
              </p>
              <button className="primary" onClick={saveToken} disabled={busy || !token.trim()}>
                {busy ? "Bezig…" : "Token opslaan"}
              </button>
            </>
          ) : (
            <>
              {status.tokenValid === false && (
                <p className="error" style={{ marginTop: 12 }}>
                  Token opgeslagen, maar Nuki gaf geen sloten terug. Klopt het token en heeft het de
                  juiste rechten?
                </p>
              )}

              <label htmlFor="nuki-lock" style={{ marginTop: 14 }}>
                Welk slot zit op de studiodeur?
              </label>
              <select
                id="nuki-lock"
                value={status.smartlockId}
                disabled={busy || status.smartlocks.length === 0}
                onChange={(e) => chooseLock(e.target.value)}
              >
                <option value="">— Kies een slot —</option>
                {status.smartlocks.map((l) => (
                  <option key={l.smartlockId} value={l.smartlockId}>
                    {l.name}
                  </option>
                ))}
              </select>

              {status.configured && (
                <>
                  <p className="muted" style={{ fontSize: 14, textTransform: "none", letterSpacing: 0, marginTop: 14 }}>
                    Klaar om te testen: maak een code aan die 15 minuten geldig is en probeer hem op
                    de keypad bij de deur.
                  </p>
                  <button className="primary" onClick={runTest} disabled={busy}>
                    {busy ? "Bezig…" : "Testcode aanmaken"}
                  </button>
                </>
              )}

              {testPin && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "14px",
                    border: "2px solid var(--green)",
                    textAlign: "center",
                  }}
                >
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    Testcode (15 min geldig)
                  </p>
                  <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 4, marginTop: 6 }}>{testPin}</div>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <button className="secondary" style={{ margin: 0 }} onClick={turnOff} disabled={busy}>
                  Uitzetten
                </button>
              </div>
            </>
          )}

          {msg && (
            <p className="muted" style={{ marginTop: 12 }}>
              {msg}
            </p>
          )}
        </>
      )}
    </div>
  );
}
