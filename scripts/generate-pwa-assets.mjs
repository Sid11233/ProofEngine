// Generates the PWA icons and the offline page from the brand name in src/lib/brand.ts.
//   node scripts/generate-pwa-assets.mjs
// Placeholder icons: a dark rounded square with the brand's first letter. To use the real logo, put a
// square PNG or SVG at public/logo.png (or logo.svg) and run this again: it is used instead of the letter.
// The generated files are committed, so builds do not depend on this script.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandSource = readFileSync(join(root, "src/lib/brand.ts"), "utf8");
const name = /name:\s*"([^"]+)"/.exec(brandSource)?.[1] ?? "App";
const THEME = "#171717";
const escapeXml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const logo = ["logo.png", "logo.svg"].map((f) => join(root, "public", f)).find(existsSync);

/** `size` px square. `padding` is the share of the canvas kept free around the mark (maskable icons need a safe zone). */
async function icon(size, { padding = 0.18, rounded = true } = {}) {
  const inner = Math.round(size * (1 - padding * 2));
  const radius = rounded ? Math.round(size * 0.22) : 0;
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${THEME}"/></svg>`);
  const mark = logo
    ? await sharp(logo).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    : await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(inner * 0.78)}" fill="#fafafa">${escapeXml(name.trim().charAt(0).toUpperCase() || "P")}</text></svg>`)).png().toBuffer();
  return sharp(background).composite([{ input: mark, gravity: "center" }]).png({ compressionLevel: 9 }).toBuffer();
}

mkdirSync(join(root, "public/icons"), { recursive: true });
const out = {
  "icon-192.png": await icon(192),
  "icon-512.png": await icon(512),
  // Maskable: full-bleed square (the OS applies its own mask) with the mark inside the 80% safe zone.
  "icon-maskable-512.png": await icon(512, { padding: 0.2, rounded: false }),
  "apple-touch-icon.png": await icon(180, { padding: 0.14, rounded: false }),
};
for (const [file, data] of Object.entries(out)) writeFileSync(join(root, "public/icons", file), data);

// The offline page is plain HTML plus an external stylesheet (the app's CSP does not allow inline styles).
writeFileSync(join(root, "public/offline.css"), `*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fafafa;color:#171717}main{max-width:26rem}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:.5rem 0}.brand{font-weight:700;letter-spacing:-.01em;margin-bottom:1.5rem}button{min-height:44px;padding:0 20px;border:0;border-radius:6px;background:#171717;color:#fafafa;font:inherit;font-weight:600;cursor:pointer}@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#fafafa}button{background:#fafafa;color:#171717}}\n`);
writeFileSync(join(root, "public/offline.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>You are offline | ${escapeXml(name)}</title>
<link rel="stylesheet" href="/offline.css">
</head>
<body>
<main>
<p class="brand">${escapeXml(name)}</p>
<h1>You are offline</h1>
<p>${escapeXml(name)} needs a connection to show your workspace. Nothing from your account is stored on this device while you are offline.</p>
<p>Check your connection, then try again.</p>
<p><a href="/app/dashboard"><button type="button">Try again</button></a></p>
</main>
</body>
</html>
`);
console.log(`generated PWA assets for "${name}"${logo ? " from the logo" : ""}`);
