import { Resend } from "resend";
import { STUDIO, DAYPART_BY_ID, formatEuro, type DaypartId } from "@/lib/config";

const globalForResend = globalThis as unknown as { resend?: Resend };

function resend(): Resend {
  if (globalForResend.resend) return globalForResend.resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY ontbreekt.");
  const client = new Resend(key);
  globalForResend.resend = client;
  return client;
}

/** "2026-05-20" -> "20-05-2026". */
function formatDateNl(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

/** Gratis WhatsApp click-to-chat link (wa.me), telefoonnummer zonder tekens. */
export function waLink(prefill?: string): string {
  const number = STUDIO.whatsapp.replace(/\D/g, "");
  return `https://wa.me/${number}${prefill ? `?text=${encodeURIComponent(prefill)}` : ""}`;
}

// ─── Gedeelde merk-bouwstenen (inbox-veilig, inline styles) ───────────────

// Donker merk-thema, gelijk aan de site. Hoekig, 2px borders, gele/groene/
// blauwe accenten. Fallback-fonts omdat mailclients web-fonts strippen.
const BRAND = {
  bg: "#0c0c0c", // buiten-achtergrond
  card: "#131311", // kaart
  dark: "#0c0c0c", // header-band + tekst op accent
  text: "#f5f5f5", // koppen / primaire tekst
  body: "#c9c9c2", // bodytekst
  dim: "#8a8a82", // subtiel
  accent: "#f3f160", // geel — CTA's, prijzen
  green: "#78b46e", // groen — WhatsApp / plug & play
  blue: "#91b9f1", // blauw — tijden / secundair
  boxBg: "#0c0c0c", // samenvattingsblok
  border: "#33332d", // ≈ rgba(245,245,245,.18) op zwart, als solide 2px border
  font: "Helvetica, Arial, sans-serif",
  display: "'Arial Black', 'Arial Narrow Bold', Impact, Helvetica, sans-serif",
};

/** Donkere merk-header met MSA-logo (hoekig). */
function header(): string {
  return `<tr><td style="background:${BRAND.dark};padding:20px 24px;border-bottom:2px solid ${BRAND.border};">
    <span style="display:inline-block;border:2px solid ${BRAND.accent};color:${BRAND.accent};
      font-family:${BRAND.display};font-size:16px;letter-spacing:1px;padding:4px 9px;">MSA</span>
    <span style="color:#ffffff;font-family:${BRAND.display};font-size:15px;letter-spacing:2px;
      text-transform:uppercase;margin-left:10px;vertical-align:middle;">Muziekstudio Alkmaar</span>
  </td></tr>`;
}

/** Groene WhatsApp-knop (gratis click-to-chat), hoekig met harde rand. */
function waButton(prefill: string): string {
  return `<a href="${waLink(prefill)}" style="background:${BRAND.green};color:${BRAND.dark};
    text-decoration:none;padding:13px 22px;display:inline-block;border:2px solid ${BRAND.dark};
    box-shadow:3px 3px 0 0 #f5f5f5;font-family:${BRAND.display};font-size:15px;
    letter-spacing:0.6px;text-transform:uppercase;">App de studio via WhatsApp</a>`;
}

/** Wikkelt content in de donkere merk-kaart. */
function shell(inner: string): string {
  return `<!doctype html><html lang="nl"><body style="margin:0;padding:24px 12px;background:${BRAND.bg};font-family:${BRAND.font};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BRAND.card}" style="max-width:560px;margin:0 auto;background:${BRAND.card};border:2px solid ${BRAND.border};">
    ${header()}
    <tr><td style="padding:28px 24px;color:${BRAND.body};line-height:1.55;font-size:15px;">
      ${inner}
    </td></tr>
  </table>
  <p style="max-width:560px;margin:16px auto 0;color:${BRAND.dim};font-size:11px;text-align:center;font-family:${BRAND.font};text-transform:uppercase;letter-spacing:1px;">
    ${STUDIO.name} · ${STUDIO.address}
  </p>
  </body></html>`;
}

// ─── Bevestigingsmail ─────────────────────────────────────────────────────

export interface BookingEmailData {
  customerName: string;
  customerEmail: string;
  date: string; // YYYY-MM-DD
  daypart: DaypartId;
  priceCents: number;
  paidWithCredit?: boolean;
}

export async function sendBookingConfirmation(data: BookingEmailData): Promise<void> {
  const dp = DAYPART_BY_ID[data.daypart];
  const dateNl = formatDateNl(data.date);
  const slotLabel = `${dp.label} (${dp.start} tot ${dp.end})`;
  const priceLine = data.paidWithCredit
    ? "Betaald met je uren-tegoed."
    : `Betaald: ${formatEuro(data.priceCents)} (incl. btw).`;

  const from = process.env.EMAIL_FROM ?? `${STUDIO.name} <boekingen@booking.muziekstudioalkmaar.nl>`;
  const subject = `Bevestiging boeking ${STUDIO.name} — ${dateNl} ${slotLabel}`;
  const waPrefill = `Hoi! Ik heb ${slotLabel} op ${dateNl} geboekt en heb een vraag.`;

  const text = `Beste ${data.customerName},

Bedankt voor je boeking — dit is je bevestiging.

Je hebt ${slotLabel} bij ${STUDIO.name} geboekt op ${dateNl}.
${priceLine}

Adres: ${STUDIO.address}
Je krijgt toegang doordat ik de deur op afstand voor je open. Hieronder staat precies hoe je binnenkomt.

Binnenkomen:
• De voordeur (schuifdeur) staat open. Dit is de glazen deur naast het skatepark.
• Loop naar binnen en ga naar de tweede etage.
• Ga door de eerste deur op de verdieping. De studio is de tweede zwarte deur aan je rechterhand.
• Bel aan bij de deur. Ik open deze op afstand.

Licht en stroom:
• Zet als eerste de schakelaar achter de koelkast aan. Die zorgt voor de stroom.
• Daarna kun je het licht in de studio aanzetten via de schakelaar links van de deur. Klik één keer op de onderkant van de schakelaar.

Speakers:
• Steek de stekkers van de speakers in het stopcontact voordat je begint.
• Haal deze er weer uit wanneer je klaar bent.

Bij vertrek:
• Licht uit via de schakelaar links van de deur en de schakelaar achter de koelkast.
• Speakers uit het stopcontact.
• De deur goed sluiten.

Kom je ergens niet uit, stuur me gerust een appje op ${STUDIO.whatsapp} (${waLink()}).
Veel plezier! Wij kijken alvast uit naar je komst!

Met vriendelijke groet,
${STUDIO.name}
${STUDIO.phone} · ${STUDIO.email}`;

  await resend().emails.send({
    from,
    to: data.customerEmail,
    subject,
    text,
    html: renderConfirmationHtml(data.customerName, slotLabel, dateNl, priceLine, waPrefill),
    ...(process.env.STUDIO_NOTIFY_EMAIL ? { bcc: process.env.STUDIO_NOTIFY_EMAIL } : {}),
  });
}

function renderConfirmationHtml(
  name: string,
  slotLabel: string,
  dateNl: string,
  priceLine: string,
  waPrefill: string,
): string {
  const li = (t: string) => `<li style="margin:5px 0;">${t}</li>`;
  const h = (t: string) =>
    `<p style="margin:22px 0 7px;font-weight:800;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${BRAND.accent};">${t}</p>`;
  const ul = (items: string[]) => `<ul style="margin:0;padding-left:20px;color:${BRAND.body};">${items.join("")}</ul>`;

  return shell(`
    <h1 style="margin:0 0 4px;font-family:${BRAND.display};font-size:26px;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.text};">Boeking bevestigd</h1>
    <p style="margin:0 0 20px;color:${BRAND.dim};">Beste ${name}, bedankt voor je boeking.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.boxBg};border:2px solid ${BRAND.border};border-left:4px solid ${BRAND.accent};margin-bottom:22px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 4px;color:${BRAND.text};font-weight:800;font-size:17px;">${slotLabel}</p>
        <p style="margin:0 0 3px;color:${BRAND.dim};">${dateNl} · ${STUDIO.name}</p>
        <p style="margin:0;color:${BRAND.accent};font-weight:700;">${priceLine}</p>
      </td></tr>
    </table>

    <p style="margin:0 0 4px;"><strong>Adres:</strong> ${STUDIO.address}</p>
    <p style="margin:0 0 4px;">Je krijgt toegang doordat ik de deur op afstand voor je open. Hieronder staat precies hoe je binnenkomt.</p>

    ${h("Binnenkomen")}
    ${ul([
      li("De voordeur (schuifdeur) staat open. Dit is de glazen deur naast het skatepark."),
      li("Loop naar binnen en ga naar de tweede etage."),
      li("Ga door de eerste deur op de verdieping. De studio is de tweede zwarte deur aan je rechterhand."),
      li("Bel aan bij de deur. Ik open deze op afstand."),
    ])}

    ${h("Licht en stroom")}
    ${ul([
      li("Zet als eerste de schakelaar achter de koelkast aan. Die zorgt voor de stroom."),
      li("Daarna kun je het licht aanzetten via de schakelaar links van de deur. Klik één keer op de onderkant."),
    ])}

    ${h("Speakers")}
    ${ul([
      li("Steek de stekkers van de speakers in het stopcontact voordat je begint."),
      li("Haal deze er weer uit wanneer je klaar bent."),
    ])}

    ${h("Bij vertrek")}
    ${ul([
      li("Licht uit via de schakelaar links van de deur en de schakelaar achter de koelkast."),
      li("Speakers uit het stopcontact."),
      li("De deur goed sluiten."),
    ])}

    <p style="margin:24px 0 12px;">Kom je ergens niet uit? Stuur me gerust een appje.</p>
    <p style="margin:0 0 6px;">${waButton(waPrefill)}</p>
    <p style="margin:16px 0 20px;">Veel plezier! Wij kijken alvast uit naar je komst.</p>

    <p style="margin:0;color:${BRAND.dim};font-size:13px;border-top:2px solid ${BRAND.border};padding-top:16px;">
      Met vriendelijke groet,<br><strong style="color:${BRAND.text};">${STUDIO.name}</strong><br>
      ${STUDIO.phone} · ${STUDIO.email}
    </p>
  `);
}

// ─── Login-mail (magic link) ──────────────────────────────────────────────

export async function sendLoginLink(email: string, link: string): Promise<void> {
  const from = process.env.EMAIL_FROM ?? `${STUDIO.name} <boekingen@booking.muziekstudioalkmaar.nl>`;
  const text = `Hoi,

Log in bij ${STUDIO.name} via deze link (30 minuten geldig):
${link}

Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.

${STUDIO.name}`;

  await resend().emails.send({ from, to: email, subject: `Inloggen bij ${STUDIO.name}`, text, html: renderLoginHtml(link) });
}

function renderLoginHtml(link: string): string {
  return shell(`
    <h1 style="margin:0 0 6px;font-family:${BRAND.display};font-size:26px;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.text};">Inloggen</h1>
    <p style="margin:0 0 22px;color:${BRAND.dim};">Klik op de knop om in te loggen. De link is 30 minuten geldig.</p>
    <p style="margin:0 0 22px;">
      <a href="${link}" style="background:${BRAND.accent};color:${BRAND.dark};text-decoration:none;
        padding:13px 26px;display:inline-block;border:2px solid ${BRAND.dark};box-shadow:3px 3px 0 0 #f5f5f5;
        font-family:${BRAND.display};font-size:16px;letter-spacing:0.6px;text-transform:uppercase;">Inloggen</a>
    </p>
    <p style="margin:0 0 6px;color:${BRAND.dim};font-size:13px;">Werkt de knop niet? Plak deze link in je browser:</p>
    <p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="${link}" style="color:${BRAND.accent};">${link}</a></p>
    <p style="margin:0;color:${BRAND.dim};font-size:13px;border-top:2px solid ${BRAND.border};padding-top:16px;">
      Heb je dit niet aangevraagd? Negeer deze e-mail.
    </p>
  `);
}

// ─── Interne notificatie naar de studio bij elke boeking ─────────────────

export async function sendAdminBookingNotification(data: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  date: string;
  daypart: DaypartId;
  priceCents: number;
  discountCents?: number;
  paidWithCredit?: boolean;
}): Promise<void> {
  const to = process.env.ADMIN_NOTIFY_EMAIL ?? "admin@muziekstudioalkmaar.nl";
  const from = process.env.EMAIL_FROM ?? `${STUDIO.name} <boekingen@booking.muziekstudioalkmaar.nl>`;
  const dp = DAYPART_BY_ID[data.daypart];
  const dateNl = formatDateNl(data.date);
  const slotLabel = `${dp.label} (${dp.start}–${dp.end})`;
  const bedrag = data.paidWithCredit
    ? "met uren-tegoed"
    : formatEuro(data.priceCents - (data.discountCents ?? 0)) +
      (data.discountCents ? ` (korting ${formatEuro(data.discountCents)})` : "");

  const text = `Nieuwe boeking!

Datum: ${dateNl}
Dagdeel: ${slotLabel}
Bedrag: ${bedrag}

Klant: ${data.customerName}
E-mail: ${data.customerEmail}
Telefoon: ${data.customerPhone}`;

  const html = shell(`
    <h1 style="margin:0 0 14px;font-family:${BRAND.display};font-size:24px;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.text};">Nieuwe boeking</h1>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.boxBg};border:2px solid ${BRAND.border};border-left:4px solid ${BRAND.accent};margin-bottom:18px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 4px;color:${BRAND.text};font-weight:800;font-size:17px;">${slotLabel}</p>
        <p style="margin:0 0 3px;color:${BRAND.blue};font-weight:700;">${dateNl}</p>
        <p style="margin:0;color:${BRAND.accent};font-weight:700;">${bedrag}</p>
      </td></tr>
    </table>
    <p style="margin:0 0 3px;"><strong style="color:${BRAND.text};">${data.customerName}</strong></p>
    <p style="margin:0 0 3px;color:${BRAND.body};">${data.customerEmail}</p>
    <p style="margin:0;color:${BRAND.body};">${data.customerPhone}</p>
  `);

  await resend().emails.send({ from, to, subject: `Nieuwe boeking: ${dateNl} ${slotLabel}`, text, html });
}

// ─── Herinnering vóór de sessie (minder no-shows) ────────────────────────

export async function sendReminderEmail(data: BookingEmailData): Promise<void> {
  const dp = DAYPART_BY_ID[data.daypart];
  const dateNl = formatDateNl(data.date);
  const slotLabel = `${dp.label} (${dp.start} tot ${dp.end})`;
  const from = process.env.EMAIL_FROM ?? `${STUDIO.name} <boekingen@booking.muziekstudioalkmaar.nl>`;
  const waPrefill = `Hoi! Ik heb ${slotLabel} op ${dateNl} geboekt.`;

  const text = `Beste ${data.customerName},

Kleine herinnering: morgen sta je in ${STUDIO.name}!

${slotLabel} — ${dateNl}
Adres: ${STUDIO.address}

Tot dan! Kom je ergens niet uit, app ons op ${STUDIO.whatsapp} (${waLink()}).

${STUDIO.name}`;

  const html = shell(`
    <h1 style="margin:0 0 4px;font-family:${BRAND.display};font-size:26px;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.text};">Tot morgen!</h1>
    <p style="margin:0 0 20px;color:${BRAND.dim};">Beste ${data.customerName}, kleine herinnering aan je sessie.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.boxBg};border:2px solid ${BRAND.border};border-left:4px solid ${BRAND.accent};margin-bottom:22px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 4px;color:${BRAND.text};font-weight:800;font-size:17px;">${slotLabel}</p>
        <p style="margin:0;color:${BRAND.blue};font-weight:700;">${dateNl} · ${STUDIO.address}</p>
      </td></tr>
    </table>
    <p style="margin:0 0 12px;">We kijken ernaar uit! Kom je ergens niet uit, laat het weten.</p>
    <p style="margin:0 0 6px;">${waButton(waPrefill)}</p>
  `);

  await resend().emails.send({ from, to: data.customerEmail, subject: `Tot morgen bij ${STUDIO.name} — ${slotLabel}`, text, html });
}

// ─── Verlaten-boeking-herinnering (recovery) ─────────────────────────────

export async function sendRecoveryEmail(data: {
  customerName: string;
  customerEmail: string;
  date: string;
  daypart: DaypartId;
}): Promise<void> {
  const dp = DAYPART_BY_ID[data.daypart];
  const dateNl = formatDateNl(data.date);
  const slotLabel = `${dp.label} (${dp.start} tot ${dp.end})`;
  const from = process.env.EMAIL_FROM ?? `${STUDIO.name} <boekingen@booking.muziekstudioalkmaar.nl>`;
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://booking.muziekstudioalkmaar.nl";

  const text = `Beste ${data.customerName},

Je was bijna klaar met het boeken van ${slotLabel} (${dateNl}) bij ${STUDIO.name}, maar de betaling is niet afgerond. Het dagdeel is mogelijk nog vrij!

Rond je boeking af: ${base}

Tot snel,
${STUDIO.name}`;

  const html = shell(`
    <h1 style="margin:0 0 4px;font-family:${BRAND.display};font-size:26px;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.text};">Bijna geboekt…</h1>
    <p style="margin:0 0 20px;color:${BRAND.dim};">Beste ${data.customerName}, je boeking is nog niet afgerond.</p>
    <p style="margin:0 0 18px;">Je was bezig met <strong style="color:${BRAND.text};">${slotLabel}</strong> op ${dateNl}, maar de betaling is niet voltooid. Het dagdeel is mogelijk nog vrij — rond je boeking snel af voordat iemand anders het pakt.</p>
    <p style="margin:0 0 6px;">
      <a href="${base}" style="background:${BRAND.accent};color:${BRAND.dark};text-decoration:none;padding:13px 26px;display:inline-block;border:2px solid ${BRAND.dark};box-shadow:3px 3px 0 0 #f5f5f5;font-family:${BRAND.display};font-size:16px;letter-spacing:0.6px;text-transform:uppercase;">Boeking afronden</a>
    </p>
  `);

  await resend().emails.send({ from, to: data.customerEmail, subject: `Je boeking bij ${STUDIO.name} is nog niet afgerond`, text, html });
}

// ─── Review-verzoek (1 dag ná de sessie) met kortingscode ────────────────

export async function sendReviewRequestEmail(data: {
  customerName: string;
  customerEmail: string;
  reviewUrl: string;
  code: string;
  rewardCents: number;
}): Promise<void> {
  const from = process.env.EMAIL_FROM ?? `${STUDIO.name} <boekingen@booking.muziekstudioalkmaar.nl>`;
  const reward = formatEuro(data.rewardCents);

  const text = `Beste ${data.customerName},

Bedankt dat je bij ${STUDIO.name} was! We hopen dat je een top sessie had.

Zou je ons willen helpen met een korte review? Het kost een minuutje:
${data.reviewUrl}

Als bedankje krijg je ${reward} korting op je volgende boeking met deze code:
${data.code}

(Eenmalig te gebruiken, 90 dagen geldig.)

Tot de volgende keer!
${STUDIO.name}`;

  const html = renderReviewRequestHtml(data.customerName, data.reviewUrl, data.code, reward);
  await resend().emails.send({ from, to: data.customerEmail, subject: `Hoe was je sessie? ${reward} korting als bedankje`, text, html });
}

function renderReviewRequestHtml(name: string, reviewUrl: string, code: string, reward: string): string {
  return shell(`
    <h1 style="margin:0 0 4px;font-family:${BRAND.display};font-size:26px;letter-spacing:0.5px;text-transform:uppercase;color:${BRAND.text};">Hoe was het?</h1>
    <p style="margin:0 0 18px;color:${BRAND.dim};">Beste ${name}, bedankt voor je sessie bij ${STUDIO.name}!</p>
    <p style="margin:0 0 18px;">Zou je ons willen helpen met een korte review? Als bedankje krijg je
      <strong style="color:${BRAND.accent};">${reward} korting</strong> op je volgende boeking.</p>
    <p style="margin:0 0 20px;">
      <a href="${reviewUrl}" style="background:${BRAND.accent};color:${BRAND.dark};text-decoration:none;padding:13px 26px;display:inline-block;border:2px solid ${BRAND.dark};box-shadow:3px 3px 0 0 #f5f5f5;font-family:${BRAND.display};font-size:16px;letter-spacing:0.6px;text-transform:uppercase;">Schrijf een review</a>
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.boxBg};border:2px solid ${BRAND.border};border-left:4px solid ${BRAND.green};margin-bottom:8px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 4px;color:${BRAND.dim};font-size:12px;text-transform:uppercase;letter-spacing:1px;">Jouw kortingscode</p>
        <p style="margin:0;color:${BRAND.accent};font-family:${BRAND.display};font-size:24px;letter-spacing:1px;">${code}</p>
        <p style="margin:6px 0 0;color:${BRAND.dim};font-size:12px;">${reward} korting · eenmalig · 90 dagen geldig</p>
      </td></tr>
    </table>
  `);
}

// ─── Preview-helpers (voor de dev-preview-route) ─────────────────────────

export function previewConfirmationHtml(): string {
  return renderConfirmationHtml(
    "Nout Kramer",
    "Avond (16:30 tot 19:30)",
    "25-07-2026",
    "Betaald: € 55,00 (incl. btw).",
    "Hoi! Ik heb Avond (16:30 tot 19:30) op 25-07-2026 geboekt en heb een vraag.",
  );
}

export function previewLoginHtml(): string {
  return renderLoginHtml("https://booking.muziekstudioalkmaar.nl/api/auth/callback?token=voorbeeld");
}

export function previewReviewHtml(): string {
  return renderReviewRequestHtml("Nout Kramer", "https://g.page/r/CXQ3bsqyLYGyEBM/review", "MSA-K7P2QX", "€ 10,00");
}
