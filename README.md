# Boekingssysteem — Muziekstudio Alkmaar

Boekingssysteem op maat voor `booking.muziekstudioalkmaar.nl`. Klanten kiezen
een datum + dagdeel, betalen via Mollie, en krijgen automatisch een
bevestigingsmail met binnenkomst-instructies. Dubbele boekingen zijn op
databaseniveau onmogelijk.

## Techstack

- **Next.js** (App Router) — UI én API in één project.
- **Postgres** (Neon of Supabase, gratis tier) — data + dubbele-boeking-garantie.
- **Mollie** — betalingen (webhook-gebaseerd).
- **Resend** — bevestigingsmails.
- **Vercel** — hosting (git push = live) + dagelijkse opruim-cron.

## Status

| Fase | Onderdeel | Status |
|---|---|---|
| **1** | Boekingsflow + Mollie + DB-locking + mail + admin | ✅ Gebouwd, lokaal geverifieerd |
| **2** | Urenpakketten (credits) + klantaccounts (login) | ✅ Gebouwd, lokaal geverifieerd |
| 3 | Google Calendar 2-weg sync | ⏳ Nog te bouwen |

### Fase 2 — hoe het werkt

- **Login:** wachtwoordloos via een magic-link (`/account/login`). Sessie in een
  HMAC-ondertekende cookie (`AUTH_SECRET`).
- **Urenpakketten (prepaid credits):** Basis (8u/€95), Pro (16u/€175), Premium
  (32u/€299) — instelbaar in `src/lib/config.ts`. Klant koopt via Mollie; credits
  komen pas op het account na bevestigde betaling (idempotent, net als boekingen).
- **Credits = minuten, in batches met vervaldatum.** Standaard 90 dagen geldig,
  ze stapelen. Verbruik gaat FIFO: de batch die het eerst vervalt gaat eerst op.
- **Boeken met tegoed:** ingelogde klant met genoeg saldo boekt zonder betaling;
  de reservering is direct definitief en de uren worden afgeboekt (met row-locking
  zodat twee gelijktijdige boekingen niet hetzelfde tegoed dubbel uitgeven).
- **Admin urenbeheer:** `/admin/klanten` — overzicht met saldo per klant;
  per klant uren toekennen of intrekken (met instelbare geldigheid) en de
  batches/boekingen bekijken. Annuleren van een tegoed-boeking boekt de uren terug.

Getest: `node tests/verify-locking.mjs` (16/16) + een volledige HTTP-flow
(login → admin kent uren toe → klant boekt met tegoed → saldo daalt → slot bezet).

### Wat is geverifieerd (fase 1)

Getest tegen een echte Postgres-engine (`node tests/verify-locking.mjs`, 16/16):

- ★ Twee gelijktijdige boekingen voor hetzelfde slot → de tweede wordt door de
  database geweigerd (partial unique index). Geen dubbele boekingen mogelijk.
- ★ Een betaalde boeking én een actieve `pending` houden het slot bezet.
- ★ Een verlopen `pending` (niet betaald) geeft het slot automatisch weer vrij.
- ★ De Mollie-webhook is idempotent: dezelfde melding twee keer verwerken boekt
  maar één keer en stuurt de mail maar één keer.
- ★ De opruim-cron verloopt alleen écht verstreken reserveringen.

Live in de browser bevestigd: beschikbaarheid (vrij/bezet/geblokkeerd/te-kort-dag),
dagdeel kiezen, formuliervalidatie, admin blokkeren + annuleren.

### Wat nog getest moet worden met jouw accounts

De echte Mollie-checkout, de webhook-aflevering door Mollie en de Resend-mail
kunnen pas end-to-end getest worden met jouw API-keys (zie hieronder).

## Lokaal draaien

Zonder eigen Postgres kun je een in-process Postgres (PGlite) gebruiken:

```bash
npm install
node tests/local-db-server.mjs      # start lokale DB op 127.0.0.1:5433
# in .env.local: DATABASE_URL="postgres://postgres@127.0.0.1:5433/postgres"
npm run dev                          # http://localhost:3000
```

Kern-garanties testen (heeft geen server nodig):

```bash
node tests/verify-locking.mjs
```

## Live gaan — stappenplan

1. **Database (Neon).** Maak een gratis project op neon.tech, kopieer de
   connection string naar `DATABASE_URL`. Draai `npm run db:migrate`.
2. **Mollie.** Voor lokaal testen: gebruik een **test-key** (`test_...`) zodat er
   geen echt geld wordt afgeschreven. Voor de live site: zet de **live-key**
   (`live_...`) bij Vercel → Environment Variables, niet in de repo. ⚠️ Een
   live-key betekent dat elke voltooide boeking echt wordt betaald.
3. **Resend.** Maak een account, verifieer het domein
   `muziekstudioalkmaar.nl`, pak de API-key → `RESEND_API_KEY`. Zet `EMAIL_FROM`
   op een adres binnen dat domein.
4. **Deploy naar Vercel.** Importeer de repo, zet alle env-variabelen uit
   `.env.example`. Vercel geeft je een URL; zet die (of het subdomein) in
   `NEXT_PUBLIC_BASE_URL`.
5. **Subdomein.** Voeg in Vercel het domein `booking.muziekstudioalkmaar.nl`
   toe en maak bij Hostnet een **CNAME** die daarnaar wijst.
6. **Cron.** `vercel.json` bevat al een dagelijkse opruim-cron als backstop.
   (De vervaltijd van onbetaalde slots wordt sowieso realtime afgedwongen, dus
   dit is alleen opruiming.)

### Mollie-webhook lokaal testen

Mollie moet je webhook kunnen bereiken. Lokaal gebruik je een tunnel:

```bash
# bijv. met cloudflared of ngrok
ngrok http 3000
# zet NEXT_PUBLIC_BASE_URL op de https-tunnel-URL en herstart de dev-server
```

Doe daarna een testboeking; Mollie's testomgeving laat je "paid/failed/expired"
kiezen. Controleer dat de status op de bevestigingspagina omslaat en de mail
aankomt.

## Vormgeving

De boekingssite is gestyled naar de huisstijl van muziekstudioalkmaar.nl:
near-black achtergrond, lime-geel accent (`#f3f160`), **Anton** (display-koppen)
+ **Archivo** (body) via `next/font` (self-hosted, geen externe CDN), scherpe
hoeken, harde offset-schaduwen en uppercase gespatieerde labels. Alle kleuren en
fonts staan als CSS-variabelen boven in `src/app/globals.css`. Dark-only, zoals
het merk. Iconen zijn SVG (`src/components/icons.tsx`), geen emoji's.

Abonnee-klanten kunnen een dagdeel **met tegoed** boeken (direct definitief) of
het **los online afrekenen** (los van hun abonnement) — beide opties staan naast
elkaar in stap 3 zodra je bent ingelogd.

## E-mail & WhatsApp

- **Bevestigings- en login-mails** (`src/lib/email.ts`) zijn gestyled in de
  huisstijl: donkere MSA-header, geel accent, leesbare lichte body. De
  bevestigingsmail bevat de volledige binnenkomst-instructies.
- **E-mails bekijken zonder te versturen:** start de dev-server en open
  `/api/dev/email-preview` (bevestiging) of `/api/dev/email-preview?type=login`.
  Deze route werkt alleen buiten productie.
- **WhatsApp:** automatisch WhatsApp-berichten sturen kan *niet* gratis/eenvoudig
  — dat vereist de WhatsApp Business API via Meta + een betaalde provider
  (Twilio/360dialog) met vooraf goedgekeurde templates. Daarom blijven de
  bevestigingen via e-mail (Resend). Wél toegevoegd: een **gratis
  click-to-chat-knop** (`wa.me`) in de mail en op de site, zodat klanten met één
  tik de studio kunnen appen. Wil je later tóch automatische WhatsApp-bevestiging,
  dan is dat een aparte (betaalde) integratie.

## Belangrijke ontwerpkeuzes

- **Prijzen incl. btw** (zoals op de website). Aanpasbaar in één bestand:
  `src/lib/config.ts`.
- **Eén dagdeel per boeking.** Meerdere dagdelen = meerdere boekingen. Houdt de
  dubbele-boeking-garantie waterdicht.
- **Geen betaling = geen boeking.** Een slot is `pending` (max 15 min) tijdens
  de checkout en wordt pas `paid` na bevestigde betaling.
- **Bron van waarheid voor beschikbaarheid = de database.** De partial unique
  index `bookings_active_slot_idx` is de harde garantie; applicatiecode is de
  vriendelijke laag eromheen.

## Projectstructuur

```
src/
  lib/
    config.ts        # tijden, prijzen, regels, tijdzone-helpers
    db.ts            # Postgres-pool + transactie-helper
    availability.ts  # beschikbaarheid berekenen
    bookings.ts      # boeken (locking) + betaalstatus (idempotent)
    mollie.ts        # Mollie-client
    email.ts         # bevestigingsmail
  db/
    schema.sql       # databaseschema (idempotent)
    migrate.ts       # npm run db:migrate
  app/
    page.tsx                     # boekingsflow (klant)
    boeking/[id]/page.tsx        # status na betaling
    admin/page.tsx               # beheer (Basic Auth)
    api/
      availability/              # GET beschikbaarheid
      bookings/                  # POST boeking + GET status
      webhooks/mollie/           # POST Mollie-webhook
      cron/expire/               # opruim-cron
      admin/                     # data / block / cancel
  middleware.ts      # Basic Auth voor /admin
tests/
  verify-locking.mjs   # kern-garanties (11 checks)
  local-db-server.mjs  # lokale PGlite-database
```
