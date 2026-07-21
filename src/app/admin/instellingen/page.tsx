"use client";

import { useEffect, useState } from "react";

export default function AdminSettingsPage() {
  const [gaId, setGaId] = useState("");
  const [metaPixelId, setMetaPixelId] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { setGaId(d.gaId ?? ""); setMetaPixelId(d.metaPixelId ?? ""); })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setMsg("");
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gaId: gaId.trim(), metaPixelId: metaPixelId.trim() }),
    });
    setMsg(res.ok ? "Opgeslagen ✓" : "Kon niet opslaan");
    setTimeout(() => setMsg(""), 2500);
  }

  return (
    <div className="wrap" style={{ maxWidth: 640 }}>
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>Instellingen</h1>
      </div>
      <p className="tagline"><a href="/admin">← Terug naar dashboard</a></p>

      <div className="card">
        <p className="step-label">Tracking</p>
        {loading ? (
          <p className="muted"><span className="spinner" /> &nbsp;Laden…</p>
        ) : (
          <>
            <label htmlFor="ga">Google Analytics Measurement-ID</label>
            <input id="ga" type="text" value={gaId} placeholder="G-XXXXXXXXXX" onChange={(e) => setGaId(e.target.value)} />
            <label htmlFor="mp">Meta Pixel-ID</label>
            <input id="mp" type="text" value={metaPixelId} placeholder="1234567890" onChange={(e) => setMetaPixelId(e.target.value)} />
            <button className="primary" onClick={save}>Opslaan</button>
            {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
            <p className="muted" style={{ marginTop: 14, fontSize: 13, textTransform: "none", letterSpacing: 0 }}>
              De scripts worden pas geladen nadat de bezoeker cookies accepteert (AVG). Laat een
              veld leeg om die tracker uit te zetten.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
