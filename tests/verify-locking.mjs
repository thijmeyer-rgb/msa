/**
 * Verifieert de kern-garanties van fase 1 tegen een echte Postgres-engine
 * (PGlite, in-process). Focus: de dubbele-boeking-bescherming, het vrijgeven
 * van verlopen slots, de beschikbaarheidsquery en de idempotente betaalstatus.
 *
 *   node tests/verify-locking.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(__dirname, "../src/db/schema.sql"), "utf8");

let pass = 0;
let fail = 0;
function ok(name) {
  pass++;
  console.log(`  ✓ ${name}`);
}
function bad(name, detail) {
  fail++;
  console.log(`  ✗ ${name}\n    → ${detail}`);
}
function isUniqueViolation(err) {
  const code = err?.code ?? err?.cause?.code;
  return code === "23505" || /duplicate key|unique/i.test(err?.message ?? "");
}

const db = new PGlite();

async function newCustomer(email = "test@example.com") {
  const r = await db.query(
    `INSERT INTO customers (name, email, phone) VALUES ($1,$2,$3)
     ON CONFLICT (lower(email)) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    ["Test Klant", email, "0612345678"],
  );
  return r.rows[0].id;
}

async function main() {
  console.log("▶ Schema toepassen…");
  await db.exec(schema);
  ok("schema toegepast (tabellen, checks, partial unique index)");

  const DATE = "2026-08-15";
  const cust = await newCustomer();

  // ── Test 1: eerste actieve boeking lukt ──────────────────────────────
  const future = new Date(Date.now() + 15 * 60000).toISOString();
  await db.query(
    `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, expires_at)
     VALUES ($1,'avond','pending',$2,5500,$3)`,
    [DATE, cust, future],
  );
  ok("eerste 'pending' boeking voor het slot toegevoegd");

  // ── Test 2: tweede actieve boeking zelfde slot → MOET falen ──────────
  try {
    await db.query(
      `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, expires_at)
       VALUES ($1,'avond','pending',$2,5500,$3)`,
      [DATE, cust, future],
    );
    bad("dubbele boeking geweigerd", "tweede insert lukte — GEEN bescherming!");
  } catch (err) {
    if (isUniqueViolation(err)) ok("dubbele boeking (pending+pending) geweigerd door unique index ★");
    else bad("dubbele boeking geweigerd", `andere fout: ${err.message}`);
  }

  // ── Test 3: 'paid' houdt slot óók bezet ──────────────────────────────
  await db.query(`UPDATE bookings SET status='paid', expires_at=NULL WHERE booking_date=$1`, [DATE]);
  try {
    await db.query(
      `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, expires_at)
       VALUES ($1,'avond','pending',$2,5500,$3)`,
      [DATE, cust, future],
    );
    bad("betaald slot blijft bezet", "insert naast 'paid' lukte — fout!");
  } catch (err) {
    if (isUniqueViolation(err)) ok("naast een 'paid' boeking kan geen nieuwe geboekt worden ★");
    else bad("betaald slot blijft bezet", `andere fout: ${err.message}`);
  }

  // ── Test 4: geannuleerd/expired slot komt weer vrij ──────────────────
  await db.query(`UPDATE bookings SET status='canceled' WHERE booking_date=$1`, [DATE]);
  try {
    await db.query(
      `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, expires_at)
       VALUES ($1,'avond','pending',$2,5500,$3)`,
      [DATE, cust, future],
    );
    ok("na annulering is hetzelfde slot weer boekbaar");
  } catch (err) {
    bad("slot vrij na annulering", `insert faalde: ${err.message}`);
  }

  // ── Test 5: beschikbaarheidsquery — verlopen 'pending' telt niet mee ──
  const past = new Date(Date.now() - 60000).toISOString();
  await db.query(`UPDATE bookings SET status='expired' WHERE booking_date=$1`, [DATE]);
  // Nieuwe pending met VERLOPEN expiry:
  await db.query(
    `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, expires_at)
     VALUES ($1,'ochtend','pending',$2,4500,$3)`,
    [DATE, cust, past],
  );
  const avail = await db.query(
    `SELECT daypart FROM bookings
      WHERE booking_date=$1 AND (status='paid' OR (status='pending' AND expires_at > now()))`,
    [DATE],
  );
  if (avail.rows.length === 0)
    ok("verlopen 'pending' bezet het slot niet meer in de beschikbaarheidsquery ★");
  else bad("verlopen pending vrij", `query gaf ${avail.rows.length} bezette slots i.p.v. 0`);

  // ── Test 6: blokkade verbergt een dagdeel ────────────────────────────
  await db.query(`INSERT INTO blocks (block_date, daypart, source) VALUES ($1,'middag','manual')`, [DATE]);
  const blocks = await db.query(`SELECT daypart FROM blocks WHERE block_date=$1`, [DATE]);
  if (blocks.rows.some((b) => b.daypart === "middag")) ok("handmatige blokkade opgeslagen en vindbaar");
  else bad("blokkade", "middag-blokkade niet gevonden");

  // ── Test 7: hele-dag-blokkade (daypart NULL) toegestaan ──────────────
  await db.query(`INSERT INTO blocks (block_date, daypart, source, reason) VALUES ($1,NULL,'manual','vakantie')`, [DATE]);
  const wholeDay = await db.query(`SELECT 1 FROM blocks WHERE block_date=$1 AND daypart IS NULL`, [DATE]);
  if (wholeDay.rows.length === 1) ok("hele-dag-blokkade (daypart NULL) opgeslagen");
  else bad("hele-dag-blokkade", "niet opgeslagen");

  // ── Test 8: idempotente betaalstatus-overgang ────────────────────────
  const c2 = await newCustomer("idem@example.com");
  const ins = await db.query(
    `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, mollie_payment_id, expires_at)
     VALUES ('2026-09-01','avond','pending',$1,5500,'tr_TEST',$2) RETURNING id`,
    [c2, future],
  );
  const bid = ins.rows[0].id;
  const first = await db.query(
    `UPDATE bookings SET status='paid', expires_at=NULL WHERE id=$1 AND status='pending' RETURNING id`,
    [bid],
  );
  const second = await db.query(
    `UPDATE bookings SET status='paid', expires_at=NULL WHERE id=$1 AND status='pending' RETURNING id`,
    [bid],
  );
  if (first.rows.length === 1 && second.rows.length === 0)
    ok("betaalovergang is idempotent: 1e webhook boekt, 2e doet niets (mail 1×) ★");
  else bad("idempotentie", `1e=${first.rows.length} rijen, 2e=${second.rows.length} rijen (verwacht 1 en 0)`);

  // ── Test 9: expire-cron zet alleen echt verlopen pendings op 'expired' ─
  const c3 = await newCustomer("exp@example.com");
  await db.query(
    `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, expires_at)
     VALUES ('2026-09-02','ochtend','pending',$1,4500,$2)`, [c3, past]);
  await db.query(
    `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents, expires_at)
     VALUES ('2026-09-02','avond','pending',$1,5500,$2)`, [c3, future]);
  await db.query(
    `UPDATE bookings SET status='expired'
      WHERE status='pending' AND expires_at IS NOT NULL AND expires_at < now()`);
  // Datum-specifiek controleren: verstreken ochtend → expired, geldige avond → pending.
  const day = await db.query(
    `SELECT daypart, status FROM bookings WHERE booking_date='2026-09-02' ORDER BY daypart`);
  const ochtend = day.rows.find((r) => r.daypart === "ochtend");
  const avond = day.rows.find((r) => r.daypart === "avond");
  if (ochtend?.status === "expired" && avond?.status === "pending")
    ok("expire-cron verloopt alleen verstreken pendings, laat geldige met rust ★");
  else bad("expire-cron", `ochtend=${ochtend?.status} (verwacht expired), avond=${avond?.status} (verwacht pending)`);

  // ── Test 10: check-constraint weigert ongeldig dagdeel ───────────────
  try {
    await db.query(
      `INSERT INTO bookings (booking_date, daypart, status, customer_id, price_cents)
       VALUES ('2026-09-03','onbekend','pending',$1,4500)`, [c3]);
    bad("check-constraint dagdeel", "ongeldig dagdeel werd geaccepteerd");
  } catch {
    ok("ongeldig dagdeel geweigerd door check-constraint");
  }

  // ═══ FASE 2 — credits ═══════════════════════════════════════════════
  const cc = await newCustomer("credits@example.com");
  const soon = new Date(Date.now() + 5 * 86400000).toISOString();  // over 5 dagen
  const later = new Date(Date.now() + 60 * 86400000).toISOString(); // over 60 dagen

  // ── Test 11: saldo = som van niet-verlopen batches ───────────────────
  await db.query(
    `INSERT INTO credit_batches (customer_id, minutes_total, minutes_remaining, expires_at, source)
     VALUES ($1,60,60,$2,'admin'), ($1,120,120,$3,'purchase')`, [cc, soon, later]);
  const bal1 = await db.query(
    `SELECT COALESCE(SUM(minutes_remaining),0)::int AS n FROM credit_batches
      WHERE customer_id=$1 AND minutes_remaining>0 AND (expires_at IS NULL OR expires_at>now())`, [cc]);
  if (bal1.rows[0].n === 180) ok("saldo = som van geldige batches (180 min)");
  else bad("saldo", `kreeg ${bal1.rows[0].n}, verwacht 180`);

  // ── Test 12: FIFO-verbruik neemt eerst de vroegst-vervallende batch ──
  // Simuleer consumeCredits(90): 60 uit 'soon', 30 uit 'later'.
  {
    let need = 90;
    const batches = (await db.query(
      `SELECT id, minutes_remaining FROM credit_batches
        WHERE customer_id=$1 AND minutes_remaining>0 AND (expires_at IS NULL OR expires_at>now())
        ORDER BY expires_at ASC NULLS LAST FOR UPDATE`, [cc])).rows;
    for (const b of batches) {
      if (need <= 0) break;
      const take = Math.min(need, b.minutes_remaining);
      await db.query(`UPDATE credit_batches SET minutes_remaining = minutes_remaining - $1 WHERE id=$2`, [take, b.id]);
      need -= take;
    }
    const after = (await db.query(
      `SELECT expires_at, minutes_remaining FROM credit_batches WHERE customer_id=$1 ORDER BY expires_at ASC`, [cc])).rows;
    if (after[0].minutes_remaining === 0 && after[1].minutes_remaining === 90)
      ok("FIFO-verbruik leegt eerst de vroegst-vervallende batch ★");
    else bad("FIFO", `soon=${after[0].minutes_remaining} (verw 0), later=${after[1].minutes_remaining} (verw 90)`);
  }

  // ── Test 13: onvoldoende saldo wordt gedetecteerd ────────────────────
  {
    const avail = (await db.query(
      `SELECT COALESCE(SUM(minutes_remaining),0)::int AS n FROM credit_batches
        WHERE customer_id=$1 AND minutes_remaining>0 AND (expires_at IS NULL OR expires_at>now())`, [cc])).rows[0].n;
    // saldo is nu 90; een aanvraag van 180 (late night=240? hier 180) moet 'te weinig' zijn
    if (avail < 180) ok("onvoldoende saldo (90 < 180) correct herkend");
    else bad("onvoldoende saldo", `saldo ${avail} onverwacht ≥ 180`);
  }

  // ── Test 14: verlopen batch telt niet mee in saldo ───────────────────
  const ce = await newCustomer("expcred@example.com");
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  await db.query(
    `INSERT INTO credit_batches (customer_id, minutes_total, minutes_remaining, expires_at, source)
     VALUES ($1,480,480,$2,'purchase')`, [ce, yesterday]);
  const balExp = (await db.query(
    `SELECT COALESCE(SUM(minutes_remaining),0)::int AS n FROM credit_batches
      WHERE customer_id=$1 AND minutes_remaining>0 AND (expires_at IS NULL OR expires_at>now())`, [ce])).rows[0].n;
  if (balExp === 0) ok("verlopen batch telt niet mee in het saldo ★");
  else bad("verlopen batch", `saldo ${balExp}, verwacht 0`);

  // ── Test 15: pakket-aankoop is idempotent (credits 1× bijgeboekt) ────
  const cp = await newCustomer("pkg@example.com");
  const order = (await db.query(
    `INSERT INTO package_orders (customer_id, package_key, minutes, price_cents, validity_days, status, mollie_payment_id)
     VALUES ($1,'basis',480,9500,90,'pending','tr_PKG') RETURNING id`, [cp])).rows[0];
  // Simuleer webhook 2×: alleen de eerste overgang pending→paid mag crediteren.
  async function processPackagePaid(paymentId) {
    const o = (await db.query(`SELECT id, status, customer_id, minutes FROM package_orders WHERE mollie_payment_id=$1 FOR UPDATE`, [paymentId])).rows[0];
    if (!o || o.status === "paid") return false;
    await db.query(`UPDATE package_orders SET status='paid' WHERE id=$1`, [o.id]);
    await db.query(`INSERT INTO credit_batches (customer_id, minutes_total, minutes_remaining, source, package_key, mollie_payment_id)
                    VALUES ($1,$2,$2,'purchase','basis',$3)`, [o.customer_id, o.minutes, paymentId]);
    return true;
  }
  const g1 = await processPackagePaid("tr_PKG");
  const g2 = await processPackagePaid("tr_PKG");
  const pkgBal = (await db.query(`SELECT COALESCE(SUM(minutes_remaining),0)::int AS n FROM credit_batches WHERE customer_id=$1`, [cp])).rows[0].n;
  if (g1 === true && g2 === false && pkgBal === 480)
    ok("pakket-aankoop idempotent: credits exact 1× bijgeboekt (480 min) ★");
  else bad("pakket-idempotentie", `1e=${g1}, 2e=${g2}, saldo=${pkgBal} (verwacht true/false/480)`);

  // ═══ FASE 4 — kortingscodes ═════════════════════════════════════════
  // Simuleer validateDiscount-logica in SQL/JS (spiegelt src/lib/discounts.ts).
  const MINCHARGE = 100;
  function calcDiscount(row, base) {
    let dc = row.type === "percent" ? Math.round(base * row.value / 100) : Math.min(row.value, base);
    return Math.min(dc, Math.max(0, base - MINCHARGE));
  }

  // ── Test 16: percentage-code rekent correct ─────────────────────────
  await db.query(`INSERT INTO discount_codes(code,type,value) VALUES('ZOMER10','percent',10)`);
  {
    const r = (await db.query(`SELECT * FROM discount_codes WHERE code='ZOMER10'`)).rows[0];
    const dc = calcDiscount(r, 5500); // avond €55
    if (dc === 550) ok("percentage-korting: 10% van €55 = €5,50 ★");
    else bad("percentage", `kreeg ${dc}, verwacht 550`);
  }

  // ── Test 17: vast bedrag, nooit onder minimum ───────────────────────
  await db.query(`INSERT INTO discount_codes(code,type,value) VALUES('MEGA','fixed',9900)`);
  {
    const r = (await db.query(`SELECT * FROM discount_codes WHERE code='MEGA'`)).rows[0];
    const dc = calcDiscount(r, 4500); // ochtend €45; korting €99 zou negatief maken
    const final = 4500 - dc;
    if (final >= MINCHARGE && dc === 4400) ok("vast bedrag capt op minimaal te betalen (€1 blijft over) ★");
    else bad("vast bedrag cap", `dc=${dc}, final=${final}`);
  }

  // ── Test 18: unieke code (case-insensitive) ─────────────────────────
  try {
    await db.query(`INSERT INTO discount_codes(code,type,value) VALUES('zomer10','fixed',500)`);
    bad("unieke code", "dubbele code (andere case) werd geaccepteerd");
  } catch (err) {
    if (isUniqueViolation(err)) ok("dubbele code (case-insensitive) geweigerd ★");
    else bad("unieke code", `andere fout: ${err.message}`);
  }

  // ── Test 19: max_uses bereikt → niet meer geldig ────────────────────
  await db.query(`INSERT INTO discount_codes(code,type,value,max_uses,used_count) VALUES('OP','percent',10,3,3)`);
  {
    const r = (await db.query(`SELECT * FROM discount_codes WHERE code='OP'`)).rows[0];
    const valid = r.active && !(r.max_uses != null && r.used_count >= r.max_uses);
    if (!valid) ok("code met bereikt max-gebruik is niet meer geldig ★");
    else bad("max_uses", "code onterecht nog geldig");
  }

  // ── Test 20: verlopen code ──────────────────────────────────────────
  await db.query(`INSERT INTO discount_codes(code,type,value,expires_at) VALUES('OUD','percent',10, now() - '1 day'::interval)`);
  {
    const r = (await db.query(`SELECT * FROM discount_codes WHERE code='OUD'`)).rows[0];
    const valid = !(r.expires_at && new Date(r.expires_at) < new Date());
    if (!valid) ok("verlopen code wordt geweigerd ★");
    else bad("verlopen code", "onterecht geldig");
  }

  // ── Test 21: gebruiksteller ophogen bij betaling ────────────────────
  const before = (await db.query(`SELECT used_count FROM discount_codes WHERE code='ZOMER10'`)).rows[0].used_count;
  await db.query(`UPDATE discount_codes SET used_count = used_count + 1 WHERE code='ZOMER10'`);
  const after = (await db.query(`SELECT used_count FROM discount_codes WHERE code='ZOMER10'`)).rows[0].used_count;
  if (after === before + 1) ok("gebruiksteller correct opgehoogd bij bevestigde betaling");
  else bad("gebruiksteller", `${before} → ${after}`);

  // ═══ FASE 4 — e-mail-automatiseringen (selectie-logica) ═════════════
  const ca = await newCustomer("autom@example.com");

  // ── Test 22: reminder pikt morgen-betaald-nog-niet-gemaild ──────────
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents) VALUES(current_date+1,'avond','paid',$1,5500)`,[ca]);
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents,reminder_sent_at) VALUES(current_date+1,'ochtend','paid',$1,4500, now())`,[ca]); // al gemaild
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents) VALUES(current_date+5,'avond','paid',$1,5500)`,[ca]); // niet morgen
  {
    const rows = (await db.query(
      `SELECT b.id FROM bookings b JOIN customers c ON c.id=b.customer_id
        WHERE b.status='paid' AND b.booking_date=current_date+1 AND b.reminder_sent_at IS NULL AND c.email<>''`)).rows;
    if (rows.length === 1) ok("reminder selecteert alleen morgen-betaald-nog-niet-gemaild ★");
    else bad("reminder-selectie", `kreeg ${rows.length}, verwacht 1`);
  }

  // ── Test 23: recovery pikt recent afgehaakt, niet als slot betaald is ─
  const cb = await newCustomer("recov@example.com");
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents,created_at) VALUES(current_date+2,'middag','expired',$1,5500, now())`,[cb]); // recover-kandidaat
  // afgehaakt maar slot inmiddels door ander betaald → NIET mailen
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents,created_at) VALUES(current_date+2,'avond','expired',$1,5500, now())`,[cb]);
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents) VALUES(current_date+2,'avond','paid',$1,5500)`,[cb]);
  {
    const rows = (await db.query(
      `SELECT b.id, b.daypart FROM bookings b JOIN customers c ON c.id=b.customer_id
        WHERE b.status IN ('expired','failed','canceled') AND b.recovery_sent_at IS NULL
          AND b.created_at >= now() - interval '3 days' AND b.booking_date = current_date+2 AND c.email<>''
          AND NOT EXISTS (SELECT 1 FROM bookings p WHERE p.booking_date=b.booking_date AND p.daypart=b.daypart AND p.status='paid')`)).rows;
    const daydelen = rows.map(r=>r.daypart);
    if (rows.length === 1 && daydelen[0] === 'middag') ok("recovery mailt afgehaakte, maar niet als het slot al betaald is ★");
    else bad("recovery-selectie", `kreeg ${JSON.stringify(daydelen)}, verwacht ['middag']`);
  }

  // ── Test 24: auto-gegenereerde review-code is correct opgeslagen ────
  await db.query(`INSERT INTO discount_codes(code,type,value,max_uses,expires_at,auto_generated)
                  VALUES('MSA-TEST99','fixed',1000,1, now() + ('90' || ' days')::interval, true)`);
  {
    const r = (await db.query(
      `SELECT type,value,max_uses,auto_generated,(expires_at > now()) AS future FROM discount_codes WHERE code='MSA-TEST99'`)).rows[0];
    if (r.type === 'fixed' && r.value === 1000 && r.max_uses === 1 && r.auto_generated === true && r.future)
      ok("auto-review-code: €10 vast, 1× te gebruiken, 90 dagen geldig ★");
    else bad("auto-review-code", JSON.stringify(r));
  }

  // ── Test 25: review-selectie pikt gisteren-betaald-nog-niet-gevraagd ─
  const cr = await newCustomer("review@example.com");
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents) VALUES(current_date-1,'avond','paid',$1,5500)`,[cr]);
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents,review_requested_at) VALUES(current_date-1,'ochtend','paid',$1,4500, now())`,[cr]); // al gevraagd
  await db.query(`INSERT INTO bookings(booking_date,daypart,status,customer_id,price_cents) VALUES(current_date-3,'middag','paid',$1,5500)`,[cr]); // niet gisteren
  {
    const rows = (await db.query(
      `SELECT b.id FROM bookings b JOIN customers c ON c.id=b.customer_id
        WHERE b.status='paid' AND b.booking_date=current_date-1 AND b.review_requested_at IS NULL
          AND c.email='review@example.com'`)).rows;
    if (rows.length === 1) ok("review-selectie: alleen gisteren-betaald-nog-niet-gevraagd ★");
    else bad("review-selectie", `kreeg ${rows.length}, verwacht 1`);
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"}  ${pass} geslaagd, ${fail} mislukt`);
  await db.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Testscript-fout:", e);
  process.exit(1);
});
