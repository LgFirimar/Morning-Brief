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
// warn:true → source tagged ⚠️ in context sent to Claude (political bias / low reliability)
const RSS = {
  canada:  [
    { url: "https://rss.cbc.ca/lineup/canada.xml" },
    { url: "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/" },
    { url: "https://globalnews.ca/canada/feed/" },
  ],
  toronto: [
    { url: "https://rss.cbc.ca/lineup/toronto.xml" },
    { url: "https://globalnews.ca/toronto/feed/" },
    { url: "https://toronto.citynews.ca/feed/" },
  ],
  israel:  [
    { url: "https://www.timesofisrael.com/feed/" },
    { url: "https://www.jpost.com/rss/rssfeedsfrontpage.aspx" },
    { url: "https://www.ynetnews.com/Integration/StoryRss2.xml" },
    { url: "https://rss.walla.co.il/feed/1" },
    { url: "https://www.israelhayom.co.il/rss.xml" },
    // ערוץ 14, מאקו, חדשות 12/13, הארץ — אין RSS נגיש (bot protection / paywall)
  ],
  world:   [
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml" },
  ],
  usa:     [
    { url: "https://feeds.npr.org/1001/rss.xml" },
    { url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml" },
    { url: "https://www.cbsnews.com/latest/rss/main" },
    { url: "https://rss.politico.com/politics-news.xml" },
    { url: "https://moxie.foxnews.com/google-publisher/us.xml", warn: true },
  ],
  uk:      [
    { url: "https://feeds.bbci.co.uk/news/uk/rss.xml" },
    { url: "https://www.theguardian.com/uk/rss" },
    { url: "https://feeds.skynews.com/feeds/rss/uk.xml" },
  ],
  france:  [
    { url: "https://www.lemonde.fr/rss/une.xml" },
    { url: "https://www.france24.com/en/rss" },
    { url: "https://www.lefigaro.fr/rss/figaro_actualites.xml" },
  ],
  germany: [
    { url: "https://rss.dw.com/rdf/rss-en-all" },
    { url: "https://www.spiegel.de/international/index.rss" },
  ],
  italy:   [
    { url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml" },
    { url: "https://www.france24.com/en/rss" },
  ],
  spain:   [
    { url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml" },
    { url: "https://www.france24.com/en/rss" },
  ],
  japan:   [
    { url: "https://www3.nhk.or.jp/rss/news/cat0.xml" },
    { url: "https://www.japantimes.co.jp/feed/" },
  ],
  india:     [
    { url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml" },
  ],
  australia: [
    { url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
    { url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml" },
  ],
  lebanon:   [
    { url: "https://en.annahar.com/rss" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml" },
    { url: "https://www.middleeasteye.net/rss" },
  ],
  egypt:     [
    { url: "https://www.egyptindependent.com/feed/" },
    { url: "https://egyptianstreets.com/feed/" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml" },
  ],
  jordan:    [
    { url: "https://www.al-monitor.com/rss" },
    { url: "https://www.middleeasteye.net/rss" },
    { url: "https://www.aljazeera.com/xml/rss/all.xml" },
  ],
  syria:     [
    { url: "https://syriadirect.org/feed/" },
    { url: "https://www.al-monitor.com/rss" },
    { url: "https://www.middleeasteye.net/rss" },
  ],
  saudi:     [
    { url: "https://www.arabnews.com/rss.xml" },
    { url: "https://www.al-monitor.com/rss" },
    { url: "https://www.middleeasteye.net/rss" },
  ],
  qatar:     [
    { url: "https://www.aljazeera.com/xml/rss/all.xml" },
    { url: "https://www.al-monitor.com/rss" },
  ],
  iran:      [
    { url: "https://www.al-monitor.com/rss" },
    { url: "https://www.middleeasteye.net/rss" },
    { url: "https://www.presstv.ir/rss.xml", warn: true },
  ],
};

const HEADINGS = {
  canada:    "🇨🇦 קנדה",      toronto:   "🏙️ טורונטו",  israel:    "🇮🇱 ישראל",
  world:     "🌍 עולם",       usa:       "🇺🇸 ארה״ב",    uk:        "🇬🇧 בריטניה",
  france:    "🇫🇷 צרפת",      germany:   "🇩🇪 גרמניה",   italy:     "🇮🇹 איטליה",
  spain:     "🇪🇸 ספרד",      japan:     "🇯🇵 יפן",      india:     "🇮🇳 הודו",
  australia: "🇦🇺 אוסטרליה",  lebanon:   "🇱🇧 לבנון",    egypt:     "🇪🇬 מצריים",
  jordan:    "🇯🇴 ירדן",      syria:     "🇸🇾 סוריה",    saudi:     "🇸🇦 סעודיה",
  qatar:     "🇶🇦 קטאר",      iran:      "🇮🇷 איראן",
};

// ─── RSS FETCHER ──────────────────────────────────────────────────────────────
function extractCDATA(xml, tag) {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
  return (re.exec(xml) || [])[1]?.trim() || "";
}

async function fetchSingleRSS({ url, warn = false }) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MorningBrief/1.0)" },
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml   = await res.text();
    const host  = new URL(url).hostname.replace("www.", "");
    const items = [];
    const rx    = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = rx.exec(xml)) !== null && items.length < 5) {
      const chunk = m[1];
      const title = extractCDATA(chunk, "title");
      const link  = extractCDATA(chunk, "link") || extractCDATA(chunk, "guid");
      const desc  = extractCDATA(chunk, "description").replace(/<[^>]+>/g, "").slice(0, 160);
      const rawSrc = (/<source[^>]*>([^<]*)<\/source>/i.exec(chunk) || [])[1]?.trim() || host;
      const src   = warn ? `⚠️ ${rawSrc} (אמינות נמוכה — נטייה פוליטית חזקה)` : rawSrc;
      if (title) items.push({ title, link, desc, src });
    }
    return items;
  } catch {
    return [];
  }
}

async function fetchRSS(countryKey) {
  const feeds   = RSS[countryKey] || RSS.canada;
  const results = await Promise.allSettled(feeds.map(fetchSingleRSS));
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
  return items.slice(0, 14)
    .map(i => `כותרת: ${i.title}\nURL: ${i.link}\nמקור: ${i.src}\nתקציר: ${i.desc}`)
    .join("\n---\n");
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `אתה עיתונאי ישראלי מנוסה. כתוב בעברית רהוטה וטבעית, חושב ישירות בעברית.
אל תכתוב מבוא — עבור ישירות לתוכן.
לעולם אל תוסיף הסתייגויות על מגבלות ידע — פשוט דווח על הידיעות שקיבלת.
אם מקור מסומן ב-⚠️ — ציין זאת בידיעה: "⚠️ לפי [שם מקור] (מקור בעל נטייה פוליטית — מומלץ לאמת)"`;

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
