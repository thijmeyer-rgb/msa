"use client";

import { useState } from "react";
import { MailIcon } from "@/components/icons";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!/\S+@\S+\.\S+/.test(email)) return;
    setLoading(true);
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="wrap" style={{ maxWidth: 460 }}>
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>Inloggen</h1>
      </div>
      <p className="tagline">Voor je uren-tegoed en boekingen.</p>

      <div className="card">
        {sent ? (
          <div className="center">
            <div className="status-icon ok"><MailIcon /></div>
            <h2>Check je mail</h2>
            <p className="muted">
              Als er een account bij <strong>{email}</strong> hoort, staat er een inloglink in je
              inbox. De link is 30 minuten geldig.
            </p>
          </div>
        ) : (
          <>
            <p className="step-label">Log in met je e-mailadres</p>
            <label htmlFor="email">E-mailadres</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button className="primary" onClick={submit} disabled={loading}>
              {loading ? "Versturen…" : "Stuur inloglink"}
            </button>
            <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              Geen wachtwoord nodig — we sturen je een beveiligde link.
            </p>
          </>
        )}
      </div>

      <p className="footer-note">
        <a href="/">← Terug naar boeken</a>
      </p>
    </div>
  );
}
