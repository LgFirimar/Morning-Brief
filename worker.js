// Morning Brief — Cloudflare Worker proxy for Anthropic API
// Solves iOS Safari CORS restrictions.
//
// Deploy:
//   1. Go to dash.cloudflare.com → Workers & Pages → Create Worker
//   2. Paste this file, click Deploy
//   3. Copy the worker URL (e.g. https://morning-brief.YOUR-NAME.workers.dev)
//   4. Open the app → Settings → API tab → paste URL into "Proxy URL"

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
  "Access-Control-Max-Age":       "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: { message: "Missing x-api-key header" } }),
        { status: 401, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const body = await request.text();

    const upstream = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       apiKey,
        "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
      },
      body,
    });

    const text = await upstream.text();

    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  },
};
