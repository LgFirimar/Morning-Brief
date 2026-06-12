// Morning Brief — Cloudflare Worker
// GET  / → serves the app (fetched from GitHub Pages)
// POST / → proxies to Anthropic; accepts apiKey in body so browser
//           only needs Content-Type (no custom headers = no CORS preflight)

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const GITHUB_PAGES = "https://lgfirimar.github.io/Morning-Brief/";

export default {
  async fetch(request) {
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

    // Serve the app
    if (method === "GET") {
      const res  = await fetch(GITHUB_PAGES, { cf: { cacheTtl: 120 } });
      const html = await res.text();
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Simple connectivity test
    if (method === "POST" && new URL(request.url).pathname === "/test") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Proxy to Anthropic — apiKey comes in the body, not headers
    if (method === "POST") {
      let body;
      try { body = await request.json(); }
      catch { return new Response(JSON.stringify({ error: { message: "Invalid JSON body" } }), { status: 400, headers: { "Content-Type": "application/json" } }); }

      const apiKey = body._apiKey;
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: { message: "Missing _apiKey in body" } }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      // Strip _apiKey before forwarding to Anthropic
      const { _apiKey, ...anthropicBody } = body;

      const upstream = await fetch(ANTHROPIC_API, {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(anthropicBody),
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
