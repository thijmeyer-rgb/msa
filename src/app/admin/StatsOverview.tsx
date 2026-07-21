"use client";

import { useEffect, useState } from "react";

interface Stats {
  revenue: { week: number; month: number; total: number };
  upcoming: number;
  occupancy: number;
  avgBookingCents: number;
  byDaypart: { daypart: string; n: number }[];
  byWeekday: { dow: number; n: number }[];
  customers: { nieuw: number; terugkerend: number };
  outstandingCreditMinutes: number;
  conversion: number;
}

const DAYPART_LABEL: Record<string, string> = {
  ochtend: "Ochtend", middag: "Middag", avond: "Avond", latenight: "Late night",
};
const DAYPART_ORDER = ["ochtend", "middag", "avond", "latenight"];
const WEEKDAYS = [
  { dow: 1, label: "ma" }, { dow: 2, label: "di" }, { dow: 3, label: "wo" },
  { dow: 4, label: "do" }, { dow: 5, label: "vr" }, { dow: 6, label: "za" }, { dow: 0, label: "zo" },
];

function euro(cents: number): string {
  return "€" + (cents / 100).toFixed(0);
}
function euro2(cents: number): string {
  return "€" + (cents / 100).toFixed(2).replace(".", ",");
}
function hrs(min: number): string {
  const h = min / 60;
  return (Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",")) + "u";
}

export default function StatsOverview() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then(setS)
      .catch(() => {});
  }, []);

  if (!s) {
    return (
      <div className="card">
        <p className="muted"><span className="spinner" /> &nbsp;Cijfers laden…</p>
      </div>
    );
  }

  const dpMax = Math.max(1, ...s.byDaypart.map((d) => d.n));
  const dpCount = (id: string) => s.byDaypart.find((d) => d.daypart === id)?.n ?? 0;
  const wdMax = Math.max(1, ...s.byWeekday.map((d) => d.n));
  const wdCount = (dow: number) => s.byWeekday.find((d) => d.dow === dow)?.n ?? 0;

  return (
    <>
      <div className="card">
        <p className="step-label">Omzet & bezetting</p>
        <div className="stat-grid">
          <div className="stat-tile accent">
            <span className="stat-label">Omzet deze maand</span>
            <span className="stat-value">{euro(s.revenue.month)}</span>
            <span className="stat-sub">deze week {euro(s.revenue.week)}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Bezetting (30d)</span>
            <span className="stat-value">{s.occupancy}%</span>
            <span className="stat-sub">van alle dagdelen</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Aankomende boekingen</span>
            <span className="stat-value">{s.upcoming}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Gem. boeking</span>
            <span className="stat-value">{euro2(s.avgBookingCents)}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Conversie (30d)</span>
            <span className="stat-value">{s.conversion}%</span>
            <span className="stat-sub">betaald vs. afgehaakt</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Uitstaand tegoed</span>
            <span className="stat-value">{hrs(s.outstandingCreditMinutes)}</span>
            <span className="stat-sub">nog te gebruiken</span>
          </div>
        </div>
      </div>

      <div className="card">
        <p className="step-label">Populairste dagdelen</p>
        <div className="bars">
          {DAYPART_ORDER.map((id) => (
            <div key={id} className="bar-row">
              <span className="bar-label">{DAYPART_LABEL[id]}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(dpCount(id) / dpMax) * 100}%` }} />
              </span>
              <span className="bar-num">{dpCount(id)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <p className="step-label">Drukste weekdagen</p>
        <div className="weekday-bars">
          {WEEKDAYS.map((w) => (
            <div key={w.dow} className="wd-col">
              <span className="wd-bar" style={{ height: `${Math.max(6, (wdCount(w.dow) / wdMax) * 100)}%` }} />
              <span className="wd-num">{wdCount(w.dow)}</span>
              <span className="wd-label">{w.label}</span>
            </div>
          ))}
        </div>
        <div className="summary" style={{ marginTop: 6 }}>
          <span className="muted">Nieuwe klanten: <strong style={{ color: "var(--green)" }}>{s.customers.nieuw}</strong></span>
          <span className="muted">Terugkerend: <strong style={{ color: "var(--blue)" }}>{s.customers.terugkerend}</strong></span>
        </div>
      </div>
    </>
  );
}
