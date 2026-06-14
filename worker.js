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

// ─── DIRECT RSS FEEDS (verified to work from Cloudflare IPs) ────────────────
const RSS = {
  canada:  [
    "https://rss.cbc.ca/lineup/canada.xml",
    "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/",
  ],
  toronto: [
    "https://rss.cbc.ca/lineup/toronto.xml",
    "https://globalnews.ca/toronto/feed/",
  ],
  israel:  [
    "https://www.timesofisrael.com/feed/",
    "https://www.jpost.com/rss/rssfeedsfrontpage.aspx",
    "https://www.ynetnews.com/Integration/StoryRss2.xml",
  ],
  world:   [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.aljazeera.com/xml/rss/all.xml",
  ],
  usa:     [
    "https://feeds.npr.org/1001/rss.xml",
    "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",
  ],
  uk:      [
    "https://feeds.bbci.co.uk/news/uk/rss.xml",
    "https://www.theguardian.com/uk/rss",
    "https://feeds.skynews.com/feeds/rss/uk.xml",
  ],
  france:  [
    "https://www.lemonde.fr/rss/une.xml",
    "https://www.france24.com/en/rss",
    "https://www.lefigaro.fr/rss/figaro_actualites.xml",
  ],
  germany: [
    "https://rss.dw.com/rdf/rss-en-all",
    "https://www.spiegel.de/international/index.rss",
  ],
  italy:   [
    "https://feeds.bbci.co.uk/news/world/europe/rss.xml",
    "https://www.france24.com/en/rss",
  ],
  spain:   [
    "https://feeds.bbci.co.uk/news/world/europe/rss.xml",
    "https://www.france24.com/en/rss",
  ],
  japan:   [
    "https://www3.nhk.or.jp/rss/news/cat0.xml",
    "https://www.japantimes.co.jp/feed/",
  ],
  india:   [
    "https://feeds.bbci.co.uk/news/world/asia/rss.xml",
    "https://www.aljazeera.com/xml/rss/all.xml",
  ],
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

async function fetchSingleRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MorningBrief/1.0)" },
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml    = await res.text();
    const host   = new URL(url).hostname.replace("www.", "");
    const items  = [];
    const rx     = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = rx.exec(xml)) !== null && items.length < 5) {
      const chunk = m[1];
      const title = extractCDATA(chunk, "title");
      const link  = extractCDATA(chunk, "link") || extractCDATA(chunk, "guid");
      const desc  = extractCDATA(chunk, "description").replace(/<[^>]+>/g, "").slice(0, 160);
      const src   = (/<source[^>]*>([^<]*)<\/source>/i.exec(chunk) || [])[1]?.trim() || host;
      if (title) items.push({ title, link, desc, src });
    }
    return items;
  } catch {
    return [];
  }
}

async function fetchRSS(countryKey) {
  const urls    = RSS[countryKey] || RSS.canada;
  const results = await Promise.allSettled(urls.map(fetchSingleRSS));
  const seen    = new Set();
  const items   = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      if (!seen.has(item.title)) {
        seen.add(item.title);
        items.push(item);
      }
    }
  }
  return items.slice(0, 12)
    .map(i => `כותרת: ${i.title}\nURL: ${i.link}\nמקור: ${i.src}\nתקציר: ${i.desc}`)
    .join("\n---\n");
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
