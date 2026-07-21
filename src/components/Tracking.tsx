"use client";

import { useEffect, useState } from "react";

const CONSENT_KEY = "ma_consent";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    dataLayer?: any[];
    fbq?: any;
    _fbq?: any;
  }
}

let loaded = false;

/**
 * Laadt Google Analytics + Meta Pixel — maar ALLEEN na cookie-toestemming.
 * De IDs komen uit de admin-instellingen (/api/public/tracking). Zonder
 * ingevulde IDs of zonder toestemming wordt er niets geladen (AVG).
 */
function loadTrackers() {
  if (loaded) return;
  loaded = true;
  fetch("/api/public/tracking")
    .then((r) => r.json())
    .then(({ gaId, metaPixelId }: { gaId: string; metaPixelId: string }) => {
      if (gaId) {
        const s = document.createElement("script");
        s.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
        s.async = true;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        function gtag(...args: any[]) {
          window.dataLayer!.push(args);
        }
        gtag("js", new Date());
        gtag("config", gaId);
      }
      if (metaPixelId) {
        /* Standaard Meta Pixel-snippet */
        (function (f: any, b: any, e: string, v: string) {
          if (f.fbq) return;
          const n: any = (f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
          });
          if (!f._fbq) f._fbq = n;
          n.push = n;
          n.loaded = true;
          n.version = "2.0";
          n.queue = [];
          const t = b.createElement(e);
          t.async = true;
          t.src = v;
          const s0 = b.getElementsByTagName(e)[0];
          s0.parentNode.insertBefore(t, s0);
        })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
        window.fbq("init", metaPixelId);
        window.fbq("track", "PageView");
      }
    })
    .catch(() => {});
}

export default function Tracking() {
  const [consent, setConsent] = useState<string | null>("pending");

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    setConsent(stored);
    if (stored === "accepted") loadTrackers();
  }, []);

  function choose(value: "accepted" | "declined") {
    localStorage.setItem(CONSENT_KEY, value);
    setConsent(value);
    if (value === "accepted") loadTrackers();
  }

  if (consent !== null) return null; // al gekozen (of nog aan het laden)

  return (
    <div className="consent">
      <span className="consent-text">
        We gebruiken cookies voor anonieme statistieken en advertenties. Ga je akkoord?
      </span>
      <span className="consent-actions">
        <button className="secondary consent-btn" onClick={() => choose("declined")}>Weigeren</button>
        <button className="primary consent-btn" onClick={() => choose("accepted")}>Akkoord</button>
      </span>
    </div>
  );
}
