"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const next = params.get("next");
        window.location.href = next && next.startsWith("/admin") ? next : "/admin";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Inloggen mislukt.");
    } catch {
      setError("Er ging iets mis. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>Admin</h1>
      </div>
      <p className="tagline">Log in om het beheer te openen.</p>

      <div className="card">
        <form onSubmit={submit}>
          <label htmlFor="admin-password">Wachtwoord</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            required
          />
          {error && (
            <p className="error" style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
          <button type="submit" className="primary" disabled={busy || !password} style={{ marginTop: 14 }}>
            {busy ? "Bezig…" : "Inloggen"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
