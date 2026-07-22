"use client";

import { useEffect, useState } from "react";

interface Slot {
  daypart: string;
  label: string;
  start: string;
  end: string;
  hours: number;
  priceCents: number;
  available: boolean;
  reason?: string;
}

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return (Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",")) + " uur";
}

function euro(cents: number): string {
  return "€" + (cents / 100).toFixed(2).replace(".", ",");
}

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function maxDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** De eerstvolgende 3 dagen (morgen + 2), voor snelkeuze-knoppen. */
function quickDates(): { value: string; label: string; sub: string }[] {
  const iso = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const weekday = (d: Date) =>
    new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short" }).format(d).replace(".", "");
  const dayMonth = (d: Date) =>
    new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short" }).format(d).replace(".", "");
  return [1, 2, 3].map((add, i) => {
    const d = new Date();
    d.setDate(d.getDate() + add);
    return { value: iso(d), label: i === 0 ? "Morgen" : weekday(d), sub: dayMonth(d) };
  });
}

const reasonText: Record<string, string> = {
  booked: "Bezet",
  blocked: "Niet beschikbaar",
  past: "Voorbij",
  "too-soon": "Te kort dag",
};

export default function BookingPage() {
  const [date, setDate] = useState<string>(todayStr());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [numPeople, setNumPeople] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ingelogde klant + saldo (voor 'boek met tegoed').
  const [loggedIn, setLoggedIn] = useState(false);
  const [balanceMinutes, setBalanceMinutes] = useState(0);

  // Kortingscode
  const [discountCode, setDiscountCode] = useState("");
  const [discount, setDiscount] = useState<{ code: string; discountCents: number; finalCents: number } | null>(null);
  const [discountMsg, setDiscountMsg] = useState<string | null>(null);

  // Social proof (admin-instelbaar)
  const [social, setSocial] = useState<{ rating: string; count: string } | null>(null);
  useEffect(() => {
    fetch("/api/public/social")
      .then((r) => r.json())
      .then((d) => { if (d.rating || d.count) setSocial(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/account/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setLoggedIn(true);
          setBalanceMinutes(d.balanceMinutes ?? 0);
          if (d.profile?.name) setName(d.profile.name);
          if (d.profile?.phone) setPhone(d.profile.phone);
          if (d.profile?.email) setEmail(d.profile.email);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setSelected(null);
    setError(null);
    if (!date) return;
    setLoadingSlots(true);
    fetch(`/api/availability?date=${date}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setSlots(data.slots);
      })
      .catch(() => !cancelled && setError("Kon beschikbaarheid niet laden."))
      .finally(() => !cancelled && setLoadingSlots(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Korting resetten als je een ander dagdeel kiest (prijs verandert).
  useEffect(() => {
    setDiscount(null);
    setDiscountMsg(null);
  }, [selected]);

  async function applyDiscount() {
    if (!selectedSlot || !discountCode.trim()) return;
    setDiscountMsg(null);
    try {
      const res = await fetch("/api/discount/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: discountCode.trim(), daypart: selectedSlot.daypart, email: email.trim() || undefined }),
      });
      const d = await res.json();
      if (d.ok) setDiscount({ code: d.code, discountCents: d.discountCents, finalCents: d.finalCents });
      else { setDiscount(null); setDiscountMsg(d.reason ?? "Ongeldige code."); }
    } catch {
      setDiscountMsg("Kon de code niet controleren.");
    }
  }

  const selectedSlot = slots?.find((s) => s.daypart === selected) ?? null;
  const payCents = discount ? discount.finalCents : selectedSlot?.priceCents ?? 0;
  const canSubmit =
    selectedSlot && name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && phone.trim().length >= 6;

  async function handleSubmit() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          daypart: selectedSlot.daypart,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          numPeople: numPeople ? Number(numPeople) : undefined,
          discountCode: discount ? discount.code : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Er ging iets mis.");
        if (data.code === "invalid_discount") { setDiscount(null); setDiscountMsg(data.error); }
        // Bij slot_taken/not_bookable: beschikbaarheid verversen.
        if (data.code === "slot_taken" || data.code === "not_bookable") {
          setSelected(null);
          const fresh = await fetch(`/api/availability?date=${date}`).then((r) => r.json());
          if (fresh.slots) setSlots(fresh.slots);
        }
        setSubmitting(false);
        return;
      }
      // Door naar Mollie-checkout.
      window.location.href = data.checkoutUrl;
    } catch {
      setError("Kon de betaling niet starten. Probeer het opnieuw.");
      setSubmitting(false);
    }
  }

  async function handleCreditBooking() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings/credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          daypart: selectedSlot.daypart,
          numPeople: numPeople ? Number(numPeople) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Er ging iets mis.");
        if (data.code === "slot_taken" || data.code === "not_bookable") {
          setSelected(null);
          const fresh = await fetch(`/api/availability?date=${date}`).then((r) => r.json());
          if (fresh.slots) setSlots(fresh.slots);
        }
        setSubmitting(false);
        return;
      }
      // Direct bevestigd — naar de statuspagina.
      window.location.href = `/boeking/${data.bookingId}`;
    } catch {
      setError("Kon niet boeken met tegoed. Probeer het opnieuw.");
      setSubmitting(false);
    }
  }

  const canPayWithCredit =
    loggedIn && selectedSlot && balanceMinutes >= selectedSlot.hours * 60;

  return (
    <div className="wrap">
      <div className="topbar">
        <a className="brand brand-link" href="/" aria-label="Naar de startpagina">
          <span className="logo-mark">MSA</span>
          <h1>Boek studiotijd</h1>
        </a>
        <a className="account-btn" href={loggedIn ? "/account" : "/account/login"}>
          {loggedIn ? "Mijn account" : "Inloggen"}
        </a>
      </div>
      <p className="tagline">
        <span className="accent-green">Plug &amp; play</span> — kom binnen en neem direct op.
      </p>
      {social && (
        <p className="social-proof">
          <span className="stars">★</span> {social.rating && <strong>{social.rating}</strong>}
          {social.rating && social.count ? " · " : ""}
          {social.count}
        </p>
      )}
      {loggedIn && balanceMinutes > 0 && (
        <p className="muted" style={{ marginTop: -6, marginBottom: 22 }}>
          Je hebt <strong style={{ color: "var(--yellow)" }}>{fmtHours(balanceMinutes)}</strong> tegoed.
        </p>
      )}
      {!loggedIn && (
        <a className="upsell" href="/account/login">
          <span>Vaak in de studio? Met een <strong>urenpakket</strong> boek je voordeliger.</span>
          <span className="upsell-arrow">→</span>
        </a>
      )}

      {/* Stap 1: datum */}
      <div className="card">
        <p className="step-label">1 · Kies een datum</p>
        <div className="quick-dates">
          {quickDates().map((q) => (
            <button
              key={q.value}
              type="button"
              className={`quick-date${date === q.value ? " active" : ""}`}
              onClick={() => setDate(q.value)}
            >
              <span className="qd-label">{q.label}</span>
              <span className="qd-sub">{q.sub}</span>
            </button>
          ))}
        </div>
        <p className="or-label">of kies zelf een datum</p>
        <input
          type="date"
          value={date}
          min={todayStr()}
          max={maxDateStr()}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {/* Stap 2: dagdeel */}
      <div className="card">
        <p className="step-label">2 · Kies een dagdeel</p>
        {!loadingSlots && slots && (() => {
          const n = slots.filter((s) => s.available).length;
          if (n === 0) return null;
          return (
            <p className={`scarcity${n === 1 ? " hot" : ""}`}>
              {n === 1 ? "Bijna vol — nog 1 dagdeel vrij!" : `Nog ${n} van 4 dagdelen vrij`}
            </p>
          );
        })()}
        {loadingSlots && (
          <p className="muted">
            <span className="spinner" /> &nbsp;Beschikbaarheid laden…
          </p>
        )}
        {!loadingSlots && slots && (
          <div className="slots">
            {slots.map((s) => (
              <button
                key={s.daypart}
                className={`slot${selected === s.daypart ? " selected" : ""}`}
                disabled={!s.available}
                onClick={() => setSelected(s.daypart)}
                type="button"
              >
                <span className="meta">
                  <span className="label">{s.label}</span>
                  <span className="time">
                    {s.start}–{s.end}
                  </span>
                </span>
                {s.available ? (
                  <span className="price">{euro(s.priceCents)}</span>
                ) : (
                  <span className="unavail">{reasonText[s.reason ?? ""] ?? "Niet beschikbaar"}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {!loadingSlots && slots && slots.every((s) => !s.available) && (
          <p className="muted" style={{ marginTop: 12 }}>
            Geen vrije dagdelen op deze datum. Kies een andere dag.
          </p>
        )}
      </div>

      {/* Stap 3: gegevens */}
      {selectedSlot && (
        <div className="card">
          <p className="step-label">3 · Jouw gegevens</p>
          <label htmlFor="name">Naam</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <label htmlFor="email">E-mailadres</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <label htmlFor="phone">Telefoonnummer</label>
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          <label htmlFor="people">Aantal personen (optioneel)</label>
          <input
            id="people"
            type="number"
            min={1}
            max={20}
            value={numPeople}
            onChange={(e) => setNumPeople(e.target.value)}
          />

          {/* Kortingscode */}
          <label htmlFor="disc">Kortingscode (optioneel)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="disc"
              type="text"
              value={discountCode}
              placeholder="Bijv. ZOMER10"
              onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
              style={{ textTransform: "uppercase" }}
            />
            <button
              type="button"
              className="secondary"
              style={{ width: "auto", margin: 0, whiteSpace: "nowrap", padding: "0 18px" }}
              onClick={applyDiscount}
              disabled={!discountCode.trim()}
            >
              Toepassen
            </button>
          </div>
          {discount && (
            <p className="muted" style={{ marginTop: 8, color: "var(--green)" }}>
              ✓ Code <strong>{discount.code}</strong> toegepast — {euro(discount.discountCents)} korting.
            </p>
          )}
          {discountMsg && (
            <p className="muted" style={{ marginTop: 8, color: "var(--danger)" }}>{discountMsg}</p>
          )}

          <div className="summary">
            <span className="muted">
              {selectedSlot.label} · {selectedSlot.start}–{selectedSlot.end}
            </span>
            <span className="total">
              {discount && (
                <span style={{ color: "var(--text-dim)", textDecoration: "line-through", fontSize: 16, marginRight: 8 }}>
                  {euro(selectedSlot.priceCents)}
                </span>
              )}
              {euro(payCents)}
            </span>
          </div>

          {canPayWithCredit && (
            <button className="primary" disabled={submitting} onClick={handleCreditBooking}>
              {submitting ? "Bezig…" : `Boek met tegoed · ${fmtHours(selectedSlot.hours * 60)}`}
            </button>
          )}
          <button
            className={canPayWithCredit ? "secondary" : "primary"}
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
          >
            {submitting
              ? "Betaling starten…"
              : `${canPayWithCredit ? "Betaal dit dagdeel los" : "Afrekenen"} · ${euro(payCents)}`}
          </button>
          <p className="muted" style={{ marginTop: 10, fontSize: 13, textTransform: "none", letterSpacing: 0 }}>
            {canPayWithCredit
              ? "Genoeg tegoed? Boek ermee — direct definitief. Of reken dit dagdeel los online af, los van je abonnement."
              : "Je boeking is pas definitief na betaling. Je ontvangt direct een bevestiging met binnenkomst-instructies."}
          </p>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <p className="footer-note">
        Vragen? Bel of{" "}
        <a href="https://wa.me/31683503422" target="_blank" rel="noopener noreferrer">
          app via WhatsApp
        </a>{" "}
        · info@muziekstudioalkmaar.nl
      </p>
    </div>
  );
}
