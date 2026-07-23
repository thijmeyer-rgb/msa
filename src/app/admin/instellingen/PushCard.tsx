"use client";

import { useCallback, useEffect, useState } from "react";

/** base64url (VAPID-sleutel) → Uint8Array, zoals de Push API verwacht. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Expliciet op een ArrayBuffer, want de Push API accepteert geen SharedArrayBuffer.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "laden" | "kan-niet" | "uit" | "aan" | "geweigerd";

export default function PushCard() {
  const [state, setState] = useState<State>("laden");
  const [devices, setDevices] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [standalone, setStandalone] = useState(true);

  const refresh = useCallback(async () => {
    // Ondersteunt deze browser überhaupt push?
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("kan-niet");
      return;
    }
    // Op iOS werkt push alleen vanuit de app op het beginscherm.
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setStandalone(!isIos || isStandalone);

    if (Notification.permission === "denied") {
      setState("geweigerd");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub ? "aan" : "uit");
    } catch {
      setState("uit");
    }
    try {
      const res = await fetch("/api/admin/push", { cache: "no-store" });
      if (res.ok) setDevices((await res.json()).devices ?? 0);
    } catch {
      /* aantal apparaten is niet essentieel */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      // Toestemming vragen moet direct uit een klik komen (browser-eis).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "geweigerd" : "uit");
        setMsg("Geen toestemming gegeven.");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const { publicKey } = (await (await fetch("/api/admin/push")).json()) as { publicKey: string };
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const res = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 60) }),
      });
      if (!res.ok) throw new Error("opslaan mislukt");

      setState("aan");
      setMsg("Meldingen staan aan op dit apparaat ✓");
      await refresh();
    } catch (err) {
      console.error(err);
      setMsg("Aanzetten mislukt. Probeer het opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch(`/api/admin/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
        });
        await sub.unsubscribe();
      }
      setState("uit");
      setMsg("Meldingen uitgezet op dit apparaat.");
      await refresh();
    } catch {
      setMsg("Uitzetten mislukt.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/admin/push/test", { method: "POST" });
    const data = (await res.json()) as { sent?: number; error?: string };
    setMsg(res.ok ? `Testmelding verstuurd naar ${data.sent} apparaat/apparaten.` : (data.error ?? "Mislukt."));
    setBusy(false);
  }

  return (
    <div className="card">
      <p className="step-label">Meldingen bij een nieuwe boeking</p>

      {state === "laden" ? (
        <p className="muted">
          <span className="spinner" /> &nbsp;Laden…
        </p>
      ) : state === "kan-niet" ? (
        <p className="muted" style={{ fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
          Deze browser ondersteunt geen meldingen. Je blijft wel gewoon een e-mail krijgen bij elke
          boeking.
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
            Krijg direct een seintje op je telefoon zodra iemand een boeking betaalt. De e-mail blijft
            ook gewoon komen.
          </p>

          {!standalone && (
            <p className="error" style={{ marginTop: 12 }}>
              Op een iPhone werken meldingen alleen vanuit de app op je beginscherm. Zet deze pagina
              eerst via het deelmenu op je beginscherm en open hem daar.
            </p>
          )}

          {state === "geweigerd" ? (
            <p className="error" style={{ marginTop: 12 }}>
              Meldingen zijn geblokkeerd voor deze site. Zet ze weer aan in de instellingen van je
              telefoon of browser en herlaad deze pagina.
            </p>
          ) : state === "aan" ? (
            <>
              <p style={{ marginTop: 12, color: "var(--green)" }}>
                Staat aan op dit apparaat
                {devices > 1 ? ` · ${devices} apparaten aangemeld` : ""}
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button className="primary" style={{ margin: 0 }} onClick={test} disabled={busy}>
                  {busy ? "Bezig…" : "Stuur testmelding"}
                </button>
                <button className="secondary" style={{ margin: 0 }} onClick={disable} disabled={busy}>
                  Uitzetten
                </button>
              </div>
            </>
          ) : (
            <button className="primary" onClick={enable} disabled={busy || !standalone}>
              {busy ? "Bezig…" : "Meldingen aanzetten"}
            </button>
          )}
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
