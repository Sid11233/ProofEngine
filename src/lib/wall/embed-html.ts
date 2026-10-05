// The widget is plain HTML and CSS with no JavaScript at all. It is built as a string (Next.js does not
// allow react-dom/server in app code), so EVERY dynamic value goes through esc(): text, and URLs after
// they are checked to be http(s). The page's CSP forbids scripts, so even a bug here could not run one.

export interface WallItem {
  headline: string;
  clientName: string | null;
  href: string;
}

export interface WallPage {
  workspaceName: string;
  layout: "grid" | "list";
  items: WallItem[];
  badge: { href: string; name: string } | null;
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/** Escapes text for use in HTML content or a double-quoted attribute. */
export const esc = (value: string) => value.replace(/[&<>"'`]/g, (c) => ENTITIES[c]);

/** Only plain http(s) links are ever emitted; anything else becomes "#". */
export const safeHref = (href: string) => (/^https?:\/\/[^\s"'<>`]+$/i.test(href) ? href : "#");

const CSS = `
*{box-sizing:border-box}body{margin:0;padding:12px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#171717;background:transparent}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.grid{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
a.card{display:block;height:100%;padding:16px;border:1px solid #d4d4d4;border-radius:10px;background:#fff;color:inherit;text-decoration:none}
a.card:hover,a.card:focus-visible{border-color:#171717;outline:none;box-shadow:0 0 0 2px #17171733}
.h{font-weight:600}.c{display:block;margin-top:4px;font-size:14px;color:#525252}
footer{margin-top:12px;text-align:center;font-size:13px;color:#525252}footer a{color:inherit}
@media (prefers-color-scheme:dark){body{color:#fafafa}a.card{background:#171717;border-color:#404040}.c,footer{color:#a3a3a3}a.card:hover{border-color:#fafafa}}
`;

export function renderWall(page: WallPage): string {
  const items = page.items
    .map(
      (item) =>
        `<li><a class="card" href="${esc(safeHref(item.href))}" target="_top" rel="noopener"><span class="h">${esc(item.headline)}</span>${
          item.clientName ? `<span class="c">${esc(item.clientName)}</span>` : ""
        }</a></li>`,
    )
    .join("");
  const badge = page.badge ? `<footer>Powered by <a href="${esc(safeHref(page.badge.href))}" target="_top" rel="noopener">${esc(page.badge.name)}</a></footer>` : "";
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${esc(`Customer results | ${page.workspaceName}`)}</title><style>${CSS}</style></head>` +
    `<body><ul${page.layout === "grid" ? ' class="grid"' : ""}>${items}</ul>${badge}</body></html>`
  );
}

/** The CSP of the embed page: no scripts, no network, no framing except by the allowed origins. */
export function embedCsp(origins: string[]): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${origins.length > 0 ? origins.join(" ") : "'none'"}`,
  ].join("; ");
}
