// Morning Brief — Cloudflare Worker
// GET  /          → serves app HTML from GitHub Pages
// GET  /icon.png  → proxies static assets from GitHub Pages
// POST /          → { tab } → Brave Search + Claude briefing (prose)
// POST /          → { model, messages } → legacy Anthropic proxy (weekend activities)

const ANTHROPIC_API  = "https://api.anthropic.com/v1/messages";
const BRAVE_NEWS_API = "https://api.search.brave.com/res/v1/news/search";
const GITHUB_PAGES   = "https://lgfirimar.github.io/Morning-Brief/";
const MODEL          = "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── COUNTRY CONFIG ───────────────────────────────────────────────────────────
const COUNTRY_CFG = {
  canada:  { q: "Canada national news today",  cc: "CA", heading: "🇨🇦 קנדה"     },
  toronto: { q: "Toronto city news today",     cc: "CA", heading: "🏙️ טורונטו"  },
  israel:  { q: "Israel news today",           cc: "IL", heading: "🇮🇱 ישראל"    },
  world:   { q: "World international news today", cc: "US", heading: "🌍 עולם"   },
  usa:     { q: "United States news today",    cc: "US", heading: "🇺🇸 ארה״ב"   },
  uk:      { q: "United Kingdom news today",   cc: "GB", heading: "🇬🇧 בריטניה" },
  france:  { q: "France news today",           cc: "FR", heading: "🇫🇷 צרפת"    },
  germany: { q: "Germany news today",          cc: "DE", heading: "🇩🇪 גרמניה"  },
  italy:   { q: "Italy news today",            cc: "IT", heading: "🇮🇹 איטליה"  },
  spain:   { q: "Spain news today",            cc: "ES", heading: "🇪🇸 ספרד"    },
  japan:   { q: "Japan news today",            cc: "JP", heading: "🇯🇵 יפן"     },
  india:   { q: "India news today",            cc: "IN", heading: "🇮🇳 הודו"    },
};

const SYSTEM_PROMPT = `אתה עיתונאי ישראלי מנוסה. כתוב בעברית רהוטה וטבעית, כאילו חושב ישירות בעברית.
אל תכתוב מבוא — עבור ישירות לתוכן.
לגבי URLs: אם תוצאות חיפוש סופקו — השתמש רק בהן. אחרת — ציין את אתר הבית של כלי התקשורת הרלוונטי.`;

const NEWS_FORMAT = `
פורמט כל ידיעה:
**[אמוג'י + כותרת]**
3-5 משפטי פרוזה. אם יש שרשרת סיבתית: "הכל התחיל ב... → בתגובה... → כתוצאה..."
מקור: [שם](URL)
---
אמוג'י: 🔴 ביטחון | 🛡️ צבאי | 📊 פוליטיקה | 💰 כלכלה | 🌍 דיפלומטיה | 🏙️ עירוני | ⚽ ספורט`;

const SOURCES_FORMAT = `
===SOURCES===
לכל כלי תקשורת שציינת, כתוב בפורמט הזה בדיוק:
**[שם המקור]**
בעלות: [מי מחזיק בו]
נטייה: [ניטרלי / שמאל-מרכז / ימין-מרכז / שמאל / ימין]
אמינות: [⭐ עד ⭐⭐⭐⭐⭐]
הערה: [משפט אחד על מהימנות מול פייק ניוז]`;

// ─── BRAVE SEARCH ─────────────────────────────────────────────────────────────
async function braveSearch(query, countryCode, env) {
  if (!env.BRAVE_API_KEY) return "";
  try {
    const params = new URLSearchParams({
      q:           query,
      count:       "10",
      country:     countryCode,
      search_lang: "en",
      freshness:   "pd",
    });
    const res = await fetch(`${BRAVE_NEWS_API}?${params}`, {
      headers: {
        "Accept":               "application/json",
        "X-Subscription-Token": env.BRAVE_API_KEY,
      },
    });
    if (!res.ok) return "";
    const data = await res.json();
    return (data.results || []).slice(0, 10).map((r, i) =>
      `[${i + 1}] ${r.title}\nURL: ${r.url}\nמקור: ${r.meta_url?.netloc || ""}\nתקציר: ${r.description || ""}\nפרסום: ${r.age || "היום"}`
    ).join("\n\n");
  } catch {
    return "";
  }
}

// ─── NEWS HANDLER ─────────────────────────────────────────────────────────────
async function handleNewsTab(body, env) {
  const { tab, customCountry, dateStr } = body;
  const key = tab === "custom" ? (customCountry || "israel") : tab;
  const cfg = COUNTRY_CFG[key] || COUNTRY_CFG.canada;

  const results = await braveSearch(cfg.q, cfg.cc, env);

  const searchContext = results
    ? `תוצאות חיפוש עדכניות שמצאתי:\n${results}\n\nהשתמש ב-URLs האלו בלבד.`
    : `אין תוצאות חיפוש — השתמש בידע שלך, וציין קישור לאתר הבית של כל מקור.`;

  const userPrompt = `ספר לי מה קורה היום ב${cfg.heading} (${dateStr}).

${searchContext}

${NEWS_FORMAT}

כתוב ## 🗓️ ${cfg.heading} — ${dateStr} ואז 4-5 ידיעות.

${SOURCES_FORMAT}`;

  const upstream = await fetch(ANTHROPIC_API, {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 4000,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: "user", content: userPrompt }],
    }),
  });

  const data = await upstream.json();
  if (data.error) return { error: data.error };
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const [content, sources = ""] = text.split("===SOURCES===");
  return { content: content.trim(), sources: sources.trim() };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (method === "GET") {
      const pathname  = new URL(request.url).pathname;
      const assetPath = pathname === "/" ? "" : pathname.slice(1);
      const res       = await fetch(GITHUB_PAGES + assetPath, { cf: { cacheTtl: 60 } });
      const ct        = res.headers.get("Content-Type") || "application/octet-stream";
      return new Response(res.body, {
        status:  res.status,
        headers: {
          "Content-Type":              ct,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control":             ct.includes("text/html") ? "no-cache" : "public, max-age=86400",
        },
      });
    }

    if (method === "POST") {
      if (new URL(request.url).pathname === "/test") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json", ...CORS },
        });
      }

      let body;
      try { body = await request.json(); }
      catch {
        return new Response(JSON.stringify({ error: { message: "Invalid JSON" } }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }

      // News tab request → Brave Search + Claude
      if (body.tab) {
        const result = await handleNewsTab(body, env);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Legacy Anthropic proxy (weekend activities)
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
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
