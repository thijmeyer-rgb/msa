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
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/customers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function runImport() {
    setImportBusy(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });
      const data = (await res.json()) as { imported?: number; skipped?: string[]; error?: string };
      if (!res.ok) {
        setImportResult(data.error ?? "Import mislukt.");
      } else {
        const skipped = data.skipped?.length
          ? ` · ${data.skipped.length} regel(s) overgeslagen (geen e-mailadres gevonden)`
          : "";
        setImportResult(`${data.imported} klant(en) geïmporteerd${skipped}.`);
        setImportText("");
        load();
      }
    } catch {
      setImportResult("Import mislukt.");
    } finally {
      setImportBusy(false);
    }
  }

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

      {/* Bulk-import */}
      <div className="card">
        <p className="step-label">Klanten importeren</p>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Plak hieronder één klant per regel: naam, e-mailadres en telefoonnummer, gescheiden door
          komma, puntkomma of tab (bijv. geplakt uit Excel). De kolomvolgorde maakt niet uit;
          alleen het e-mailadres is verplicht. Bestaande klanten worden aangevuld, niet overschreven.
        </p>
        <textarea
          rows={5}
          placeholder={"Jan Jansen; jan@voorbeeld.nl; 0612345678\nPiet de Boer; piet@voorbeeld.nl"}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <button className="primary" onClick={runImport} disabled={importBusy || !importText.trim()}>
          {importBusy ? "Bezig…" : "Importeren"}
        </button>
        {importResult && (
          <p className="muted" style={{ marginTop: 10 }}>
            {importResult}
          </p>
        )}
      </div>

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
