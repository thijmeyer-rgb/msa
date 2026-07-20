"use client";

import { useEffect, useState } from "react";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  balance_minutes: number;
}

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return (Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",")) + " uur";
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/admin/customers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = customers.filter(
    (c) =>
      !q ||
      (c.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
      c.email.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>Klanten &amp; uren</h1>
      </div>
      <p className="tagline">
        <a href="/admin">← Boekingen &amp; blokkades</a>
      </p>

      <div className="card">
        <input type="text" placeholder="Zoek op naam of e-mail…" value={q} onChange={(e) => setQ(e.target.value)} />
        {loading ? (
          <p className="muted" style={{ marginTop: 14 }}>
            <span className="spinner" /> &nbsp;Laden…
          </p>
        ) : filtered.length === 0 ? (
          <p className="muted" style={{ marginTop: 14 }}>Geen klanten.</p>
        ) : (
          filtered.map((c) => (
            <a
              key={c.id}
              href={`/admin/klanten/${c.id}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 0",
                borderTop: "1px solid var(--border)",
                textDecoration: "none",
                color: "var(--text)",
              }}
            >
              <span>
                <strong>{c.name || "(geen naam)"}</strong>
                <br />
                <span className="muted" style={{ fontSize: 14 }}>
                  {c.email}
                </span>
              </span>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{fmtHours(c.balance_minutes)}</span>
            </a>
          ))
        )}
      </div>
    </div>
  );
}
