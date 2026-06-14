// Morning Brief — Cloudflare Worker
// GET  /  → serves app HTML from GitHub Pages
// POST /  → { tab } → Google News RSS + Claude briefing
// POST /  → { model, messages } → Anthropic proxy (weekend activities)

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const GITHUB_PAGES  = "https://lgfirimar.github.io/Morning-Brief/";
const MODEL         = "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ─── GOOGLE NEWS RSS URLS ─────────────────────────────────────────────────────
const RSS = {
  canada:  "https://news.google.com/rss/search?q=canada+news+when:1d&hl=en-CA&gl=CA&ceid=CA:en",
  toronto: "https://news.google.com/rss/search?q=toronto+news+when:1d&hl=en-CA&gl=CA&ceid=CA:en",
  israel:  "https://news.google.com/rss/search?q=israel+news+when:1d&hl=en-IL&gl=IL&ceid=IL:iw",
  world:   "https://news.google.com/rss/search?q=world+top+news+when:1d&hl=en-US&gl=US&ceid=US:en",
  usa:     "https://news.google.com/rss/search?q=united+states+news+when:1d&hl=en-US&gl=US&ceid=US:en",
  uk:      "https://news.google.com/rss/search?q=uk+britain+news+when:1d&hl=en-GB&gl=GB&ceid=GB:en",
  france:  "https://news.google.com/rss/search?q=france+news+when:1d&hl=fr&gl=FR&ceid=FR:fr",
  germany: "https://news.google.com/rss/search?q=germany+news+when:1d&hl=de&gl=DE&ceid=DE:de",
  italy:   "https://news.google.com/rss/search?q=italy+news+when:1d&hl=it&gl=IT&ceid=IT:it",
  spain:   "https://news.google.com/rss/search?q=spain+news+when:1d&hl=es&gl=ES&ceid=ES:es",
  japan:   "https://news.google.com/rss/search?q=japan+news+when:1d&hl=ja&gl=JP&ceid=JP:ja",
  india:   "https://news.google.com/rss/search?q=india+news+when:1d&hl=en-IN&gl=IN&ceid=IN:en",
};

const HEADINGS = {
  canada:  "🇨🇦 קנדה",  toronto: "🏙️ טורונטו", israel:  "🇮🇱 ישראל",
  world:   "🌍 עולם",   usa:     "🇺🇸 ארה״ב",  uk:      "🇬🇧 בריטניה",
  france:  "🇫🇷 צרפת",  germany: "🇩🇪 גרמניה", italy:   "🇮🇹 איטליה",
  spain:   "🇪🇸 ספרד",  japan:   "🇯🇵 יפן",    india:   "🇮🇳 הודו",
};

// ─── RSS FETCHER ──────────────────────────────────────────────────────────────
function extractCDATA(xml, tag) {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
  return (re.exec(xml) || [])[1]?.trim() || "";
}

async function fetchRSS(countryKey) {
  const url = RSS[countryKey] || RSS.canada;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MorningBrief/1.0)" },
    });
    if (!res.ok) return "";
    const xml = await res.text();

    const items = [];
    const rx = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = rx.exec(xml)) !== null && items.length < 10) {
      const chunk = m[1];
      const title  = extractCDATA(chunk, "title");
      const link   = extractCDATA(chunk, "link") || extractCDATA(chunk, "guid");
      const desc   = extractCDATA(chunk, "description").replace(/<[^>]+>/g, "").slice(0, 180);
      const source = (/<source[^>]*>([^<]*)<\/source>/i.exec(chunk) || [])[1]?.trim() || "";
      if (title) items.push(`כותרת: ${title}\nURL: ${link}\nמקור: ${source}\nתקציר: ${desc}`);
    }
    return items.join("\n---\n");
  } catch {
    return "";
  }
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `אתה עיתונאי ישראלי מנוסה. כתוב בעברית רהוטה וטבעית, חושב ישירות בעברית.
אל תכתוב מבוא — עבור ישירות לתוכן.
לעולם אל תוסיף הסתייגויות על מגבלות ידע — פשוט דווח על הידיעות שקיבלת.`;

const NEWS_FORMAT = `
פורמט כל ידיעה:
**[אמוג'י + כותרת]**
3-5 משפטי פרוזה. אם יש שרשרת סיבתית: "הכל התחיל ב... → בתגובה... → כתוצאה..."
מקור: [שם](URL)
---
אמוג'י: 🔴 ביטחון | 🛡️ צבאי | 📊 פוליטיקה | 💰 כלכלה | 🌍 דיפלומטיה | 🏙️ עירוני | ⚽ ספורט`;

const SOURCES_FORMAT = `
===SOURCES===
לכל כלי תקשורת שציינת:
**[שם המקור]**
בעלות: [מי מחזיק]
נטייה: [ניטרלי / שמאל-מרכז / ימין-מרכז / שמאל / ימין]
אמינות: [⭐ עד ⭐⭐⭐⭐⭐]
הערה: [משפט אחד על מהימנות מול פייק ניוז]`;

// ─── NEWS HANDLER ─────────────────────────────────────────────────────────────
async function handleNewsTab(body, env) {
  const { tab, customCountry, dateStr } = body;
  const key     = tab === "custom" ? (customCountry || "israel") : tab;
  const heading = HEADINGS[key] || HEADINGS.canada;

  const rssResults = await fetchRSS(key);

  const context = rssResults
    ? `ידיעות עדכניות לדיווח (השתמש ב-URLs האלו):\n${rssResults}`
    : "דווח על ידיעות לפי מה שאתה יודע.";

  const userPrompt = `ספר לי מה קורה היום ב${heading} (${dateStr}).

${context}

${NEWS_FORMAT}

כתוב ## 🗓️ ${heading} — ${dateStr} ואז 4-5 ידיעות חשובות.

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
      max_tokens: 3000,
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

      // News tab → Google News RSS + Claude
      if (body.tab) {
        const result = await handleNewsTab(body, env);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      // Anthropic proxy (weekend activities)
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
