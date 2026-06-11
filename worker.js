// Morning Brief — Cloudflare Worker
// GET  / → serves the app HTML (fetched from GitHub Pages)
// POST / → proxies to Anthropic API
// Same-origin for both = no CORS issues on iOS Safari

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const GITHUB_PAGES  = "https://lgfirimar.github.io/Morning-Brief/";

export default {
  async fetch(request) {
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-api-key, anthropic-version",
        },
      });
    }

    // Serve the app — user bookmarks the Worker URL on mobile
    if (method === "GET") {
      const res  = await fetch(GITHUB_PAGES, { cf: { cacheTtl: 120 } });
      const html = await res.text();
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Proxy to Anthropic — same-origin from the served app, no CORS
    if (method === "POST") {
      const apiKey = request.headers.get("x-api-key");
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: { message: "Missing x-api-key" } }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      const upstream = await fetch(ANTHROPIC_API, {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
        },
        body: await request.text(),
      });

      return new Response(await upstream.text(), {
        status:  upstream.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
