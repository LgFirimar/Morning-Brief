// Morning Brief — Cloudflare Worker
// GET  / → serves the app (fetched from GitHub Pages)
// POST / → proxies to Anthropic using server-side secret key

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const GITHUB_PAGES  = "https://lgfirimar.github.io/Morning-Brief/";

export default {
  async fetch(request, env) {
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (method === "GET") {
      const pathname  = new URL(request.url).pathname;
      const assetPath = pathname === "/" ? "" : pathname.slice(1);
      const res     = await fetch(GITHUB_PAGES + assetPath, { cf: { cacheTtl: 60 } });
      const ct      = res.headers.get("Content-Type") || "application/octet-stream";
      const isHtml  = ct.includes("text/html");
      return new Response(res.body, {
        status:  res.status,
        headers: {
          "Content-Type":                ct,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control":               isHtml ? "no-cache" : "public, max-age=86400",
        },
      });
    }

    if (method === "POST") {
      if (new URL(request.url).pathname === "/test") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      let body;
      try { body = await request.json(); }
      catch {
        return new Response(JSON.stringify({ error: { message: "Invalid JSON" } }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      const upstream = await fetch(ANTHROPIC_API, {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      return new Response(await upstream.text(), {
        status:  upstream.status,
        headers: {
          "Content-Type":                "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
