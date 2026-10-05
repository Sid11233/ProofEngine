// Presents GoTrue (:9999), PostgREST (:3000) and Storage (:5000) as one Supabase-style API on :54321.
import http from "node:http";
const routes = [["/rest/v1", 3000], ["/auth/v1", 9999], ["/storage/v1", 5000]];
http.createServer((req, res) => {
  const route = routes.find(([p]) => req.url.startsWith(p));
  if (!route) { res.writeHead(404).end(); return; }
  const [prefix, port] = route;
  const up = http.request({ host: "127.0.0.1", port, path: req.url.slice(prefix.length) || "/", method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", (e) => { res.writeHead(502).end(String(e)); });
  req.pipe(up);
}).listen(54321, "127.0.0.1");
