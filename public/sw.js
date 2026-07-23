/**
 * Service worker voor de beheer-app van Muziekstudio Alkmaar.
 *
 * BEWUST MINIMAAL: deze worker luistert ALLEEN naar push-meldingen. Er zit
 * met opzet GEEN 'fetch'-handler in, zodat hij nooit pagina's of API-antwoorden
 * kan cachen. Een beheerscherm met verouderde boekingsgegevens is erger dan
 * geen offline-ondersteuning.
 */

// Nieuwe versie meteen actief maken, zodat een update niet blijft hangen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Muziekstudio Alkmaar";
  const options = {
    body: data.body || "Er is een nieuwe boeking.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Meldingen over dezelfde boeking vervangen elkaar in plaats van te stapelen.
    tag: data.tag || "msa-booking",
    data: { url: data.url || "/admin" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Staat de app al open? Breng dat venster naar voren in plaats van een nieuw te openen.
      for (const client of clients) {
        if (client.url.includes("/admin") && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
