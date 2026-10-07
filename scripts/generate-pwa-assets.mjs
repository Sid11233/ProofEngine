// Builds the generated brand files from src/lib/brand.ts and the supplied artwork:
//   node scripts/generate-pwa-assets.mjs
//   * public/offline.html + offline.css : the branded offline page (the wordmark is cached by the service worker)
//   * src/app/favicon.ico               : built from public/icons/favicon-{16,32,48}.png
// The app icons themselves (public/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png,
// favicon.svg and the favicon PNGs) and the wordmarks (public/brand/*.svg) are supplied artwork: replace those
// files to rebrand. If an app icon is missing it is drawn as a placeholder letter so the PWA stays installable.
// The generated files are committed, so builds do not depend on this script.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandSource = readFileSync(join(root, "src/lib/brand.ts"), "utf8");
const name = /name:\s*"([^"]+)"/.exec(brandSource)?.[1] ?? "App";
const logo = /light:\s*"([^"]+)"/.exec(brandSource)?.[1];
const logoDark = /dark:\s*"([^"]+)"/.exec(brandSource)?.[1];
const escapeXml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

// Placeholder app icons, only for files that are missing.
mkdirSync(join(root, "public/icons"), { recursive: true });
for (const [file, size, padding, rounded] of [["icon-192.png", 192, 0.18, true], ["icon-512.png", 512, 0.18, true], ["icon-maskable-512.png", 512, 0.2, false], ["apple-touch-icon.png", 180, 0.14, false]]) {
  const path = join(root, "public/icons", file);
  if (existsSync(path)) continue;
  const inner = Math.round(size * (1 - padding * 2));
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rounded ? Math.round(size * 0.22) : 0}" fill="#171717"/></svg>`);
  const mark = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(inner * 0.78)}" fill="#fafafa">${escapeXml(name.trim().charAt(0).toUpperCase() || "P")}</text></svg>`)).png().toBuffer();
  writeFileSync(path, await sharp(bg).composite([{ input: mark, gravity: "center" }]).png().toBuffer());
}

// favicon.ico: an ICO container whose images are the PNG favicons.
const sizes = [16, 32, 48].filter((s) => existsSync(join(root, `public/icons/favicon-${s}.png`)));
if (sizes.length) {
  const images = sizes.map((s) => readFileSync(join(root, `public/icons/favicon-${s}.png`)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s, e);
    header.writeUInt8(s, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  writeFileSync(join(root, "src/app/favicon.ico"), Buffer.concat([header, ...images]));
}

// The offline page is plain HTML plus an external stylesheet (the app's CSP does not allow inline styles).
writeFileSync(join(root, "public/offline.css"), `*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fafaf9;color:#1a1a1a}main{max-width:26rem}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:.5rem 0}.logo{display:block;height:32px;width:auto;margin-bottom:1.5rem}.dark{display:none}a.button{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:6px;background:#1a1a1a;color:#fafaf9;font-weight:600;text-decoration:none}\n`);
const logos = logo ? `<img class="logo light" src="${logo}" alt="${escapeXml(name)}"><img class="logo dark" src="${logoDark ?? logo}" alt="" aria-hidden="true">` : `<p><strong>${escapeXml(name)}</strong></p>`;
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
${logos}
<h1>You are offline</h1>
<p>${escapeXml(name)} needs a connection to show your workspace. Nothing from your account is stored on this device while you are offline.</p>
<p>Check your connection, then try again.</p>
<p><a class="button" href="/app/dashboard">Try again</a></p>
</main>
</body>
</html>
`);
console.log(`generated brand files for "${name}"`);
