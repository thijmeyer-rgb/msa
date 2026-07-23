/**
 * Maakt de app-icons voor de beheer-PWA uit public/logo.png.
 *
 * Het logo is breed en transparant; icons moeten vierkant en dekkend zijn.
 * We plaatsen het logo daarom gecentreerd op een vlak in de merkkleur, met
 * ruime marge zodat Android het icoon mag bijsnijden (maskable safe zone)
 * zonder dat er iets van het logo afvalt.
 *
 * Draaien na het vervangen van public/logo.png:
 *   node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "../public");
const SOURCE = join(publicDir, "logo.png");

const BRAND_BG = { r: 12, g: 12, b: 12, alpha: 1 }; // #0C0C0C

/**
 * @param size    afmeting van het vierkante icoon
 * @param logoPct hoeveel procent van de breedte het logo mag innemen
 * @param out     bestandsnaam
 */
async function makeIcon(size, logoPct, out) {
  const logoWidth = Math.round(size * logoPct);
  const logo = await sharp(SOURCE).resize({ width: logoWidth }).toBuffer();
  const { height: logoHeight } = await sharp(logo).metadata();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_BG },
  })
    .composite([
      {
        input: logo,
        left: Math.round((size - logoWidth) / 2),
        top: Math.round((size - logoHeight) / 2),
      },
    ])
    .png()
    .toFile(join(publicDir, out));

  console.log(`✓ ${out} (${size}x${size}, logo ${Math.round(logoPct * 100)}%)`);
}

// 'any'-icons mogen het logo groter tonen; maskable heeft marge nodig omdat
// Android er een cirkel/afgeronde vorm uit kan snijden (veilige zone = 80%).
await makeIcon(192, 0.72, "icon-192.png");
await makeIcon(512, 0.72, "icon-512.png");
await makeIcon(512, 0.56, "icon-maskable-512.png");
// iOS gebruikt deze en snijdt zelf de hoeken af.
await makeIcon(180, 0.72, "apple-touch-icon.png");
