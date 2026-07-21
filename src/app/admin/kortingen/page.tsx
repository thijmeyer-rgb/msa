"use client";

import { useEffect, useState, useCallback } from "react";

interface Code {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  new_customers_only: boolean;
  active: boolean;
  auto_generated: boolean;
}

function fmtValue(c: Code): string {
  return c.type === "percent" ? `${c.value}%` : "€" + (c.value / 100).toFixed(2).replace(".", ",");
}
function dateNl(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}-${m}-${y}`;
}

export default function AdminDiscountsPage() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [loading, setLoading] = useState(true);

  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [newOnly, setNewOnly] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/discounts", { cache: "no-store" }).then((r) => r.json());
    setCodes(d.codes ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setError("");
    const res = await fetch("/api/admin/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code, type, value: Number(value),
        maxUses: maxUses ? Number(maxUses) : undefined,
        expiresAt: expiresAt || undefined,
        newCustomersOnly: newOnly,
      }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error ?? "Er ging iets mis."); return; }
    setCode(""); setValue(""); setMaxUses(""); setExpiresAt(""); setNewOnly(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Deze code verwijderen/deactiveren?")) return;
    await fetch(`/api/admin/discounts?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="wrap" style={{ maxWidth: 760 }}>
      <div className="brand">
        <span className="logo-mark">MSA</span>
        <h1>Kortingscodes</h1>
      </div>
      <p className="tagline"><a href="/admin">← Terug naar dashboard</a></p>

      <div className="card">
        <p className="step-label">Nieuwe code</p>
        <div className="form-grid">
          <div>
            <label htmlFor="c">Code</label>
            <input id="c" type="text" value={code} placeholder="ZOMER10" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label htmlFor="t">Type</label>
            <select id="t" value={type} onChange={(e) => setType(e.target.value as "percent" | "fixed")}>
              <option value="percent">Percentage (%)</option>
              <option value="fixed">Vast bedrag (€)</option>
            </select>
          </div>
        </div>
        <div className="form-grid">
          <div>
            <label htmlFor="v">{type === "percent" ? "Percentage" : "Bedrag in euro's"}</label>
            <input id="v" type="number" min={1} step={type === "percent" ? 1 : 0.5} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div>
            <label htmlFor="m">Max. keer te gebruiken (leeg = ∞)</label>
            <input id="m" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          </div>
        </div>
        <label htmlFor="e">Verloopt op (optioneel)</label>
        <input id="e" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        <label style={{ display: "flex", alignItems: "center", gap: 10, textTransform: "none", letterSpacing: 0, fontSize: 14, marginTop: 14 }}>
          <input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} style={{ width: "auto", minHeight: 0 }} />
          Alleen voor nieuwe klanten
        </label>
        <button className="primary" onClick={create} disabled={!code || !value}>Code aanmaken</button>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <p className="step-label">Bestaande codes</p>
        {loading ? (
          <p className="muted"><span className="spinner" /> &nbsp;Laden…</p>
        ) : codes.length === 0 ? (
          <p className="muted">Nog geen codes.</p>
        ) : (
          codes.map((c) => (
            <div key={c.id} style={{ padding: "14px 0", borderTop: "2px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <strong style={{ color: c.active ? "var(--yellow)" : "var(--text-dim)", fontFamily: "var(--font-display)", fontSize: 18 }}>{c.code}</strong>
                <span style={{ marginLeft: 10 }}>{fmtValue(c)} korting</span>
                <div className="muted" style={{ fontSize: 13 }}>
                  {c.used_count}{c.max_uses ? `/${c.max_uses}` : ""} gebruikt
                  {c.expires_at ? ` · verloopt ${dateNl(c.expires_at)}` : ""}
                  {c.new_customers_only ? " · nieuwe klanten" : ""}
                  {c.auto_generated ? " · review-beloning" : ""}
                  {!c.active ? " · INACTIEF" : ""}
                </div>
              </div>
              <button className="linkbtn" onClick={() => remove(c.id)}>verwijderen</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
