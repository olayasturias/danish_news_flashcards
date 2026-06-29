"use strict";

// ---- Config ---------------------------------------------------------------

// CORS proxies: a GitHub Pages site cannot fetch a third-party URL directly
// (the browser blocks the cross-origin request). These public proxies relay
// the raw HTML back with permissive CORS headers. Tried in order until one works.
const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

// MyMemory translation API — free, no key, CORS-enabled. da -> en.
const TRANSLATE_URL = (word) =>
  `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=da|en`;

const VOCAB_LIMIT = 200;    // hard ceiling on candidate words (free API friendliness)
const DEFAULT_COUNT = 24;   // words translated on the first run
const MIN_WORD_LEN = 3;     // ignore very short tokens
const TRANSLATE_CONCURRENCY = 4;

// ---- Elements -------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const els = {
  url: $("url"),
  go: $("go"),
  status: $("status"),
  overview: $("overview"),
  title: $("article-title"),
  meta: $("article-meta"),
  excerpt: $("article-excerpt"),
  body: $("article-body"),
  cardsSection: $("cards-section"),
  cards: $("cards"),
  cardsCount: $("cards-count"),
  sortSwitch: $("sort-switch"),
  count: $("count"),
  countVal: $("count-val"),
  countMax: $("count-max"),
};

// Holds the parsed candidates + translation cache so the slider/sort controls
// can re-render without re-fetching or re-translating.
const state = {
  vocab: [],            // all candidates [{word, count}], frequency-ranked
  cache: new Map(),     // word -> translation string | null (null = no gloss)
  count: 0,             // how many top words to translate (slider value)
  sort: "alpha",        // "alpha" | "random"
};

// ---- Status helpers -------------------------------------------------------

function status(msg, { error = false, busy = false } = {}) {
  els.status.hidden = false;
  els.status.classList.toggle("error", error);
  els.status.innerHTML = busy ? `<span class="spin"></span>${msg}` : msg;
}
function clearStatus() {
  els.status.hidden = true;
}

// ---- Fetch + extract ------------------------------------------------------

async function fetchHtml(url) {
  let lastErr;
  for (const makeUrl of PROXIES) {
    try {
      const res = await fetch(makeUrl(url), { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text && text.length > 500) return text;
      throw new Error("empty response");
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Could not fetch the article (${lastErr?.message || "all proxies failed"}).`);
}

// Parse raw HTML into a clean article using Mozilla Readability.
function extractArticle(html, sourceUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Readability resolves relative links/images against <base>.
  const base = doc.createElement("base");
  base.href = sourceUrl;
  doc.head.appendChild(base);

  const article = new Readability(doc).parse();
  if (!article || !article.textContent || article.textContent.trim().length < 80) {
    throw new Error("Couldn't find readable article text on that page.");
  }
  return article; // { title, byline, excerpt, textContent, content, siteName, ... }
}

// ---- Vocabulary -----------------------------------------------------------

// Pick the most frequent meaningful Danish words from the article text.
function buildVocab(text) {
  const tokens = text
    .toLowerCase()
    .match(/[a-zæøåäöü]+/gi) || [];

  const freq = new Map();
  for (const raw of tokens) {
    const w = raw.toLowerCase();
    if (w.length < MIN_WORD_LEN) continue;
    if (window.DANISH_STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, VOCAB_LIMIT)
    .map(([word, count]) => ({ word, count }));
}

// ---- Translation ----------------------------------------------------------

// Tidy a raw translation-memory string: drop wrapping quotes, trailing
// punctuation/symbols, and collapse whitespace.
function cleanTranslation(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'«»“”]+|["'«»“”.,;:!?\s]+$/g, "")
    .trim();
}

// Is this a usable single-word gloss? Rejects the junk MyMemory's crowd corpus
// returns for short queries: full sentences, foreign-script noise, echoes.
function isPlausibleGloss(text, word) {
  if (!text) return false;
  if (text.toLowerCase() === word.toLowerCase()) return false; // echo = no translation
  if (/[^\p{Script=Latin}\s'’\-]/u.test(text)) return false;   // digits, α, � … = noise
  if (text.split(/\s+/).length > 4) return false;              // a word ≠ a sentence
  return true;
}

// MyMemory ranks `matches` by source-string similarity (`match`), IGNORING
// translation reliability (`quality`), so unvetted junk often wins. We re-rank:
// quality first, then match, then prefer the shorter gloss.
async function translateWord(word) {
  try {
    const res = await fetch(TRANSLATE_URL(word));
    const data = await res.json();

    const raw = Array.isArray(data?.matches) && data.matches.length
      ? data.matches
      : [{ translation: data?.responseData?.translatedText, quality: 0, match: 0 }];

    const candidates = raw
      .map((m) => ({
        text: cleanTranslation(m.translation),
        quality: Number(m.quality) || 0,
        match: Number(m.match) || 0,
      }))
      .filter((c) => isPlausibleGloss(c.text, word));

    if (!candidates.length) return null;

    // A real single-word gloss comes from a TM segment that closely matches the
    // query. Low `match` + high `quality` is a near-unrelated entry (e.g.
    // borgernes -> "Client Detail"): drop those, but fall back if none survive.
    const MIN_MATCH = 0.75;
    const strong = candidates.filter((c) => c.match >= MIN_MATCH);
    const pool = strong.length ? strong : candidates;

    pool.sort(
      (a, b) =>
        b.quality - a.quality ||
        b.match - a.match ||
        a.text.length - b.text.length
    );
    return pool[0].text;
  } catch {
    return null;
  }
}

// Translate the top `n` candidate words, skipping any already in the cache.
// Limited concurrency keeps us friendly to the free API.
async function ensureTranslated(n, onProgress) {
  const targets = state.vocab
    .slice(0, n)
    .filter((v) => !state.cache.has(v.word));
  if (!targets.length) return;

  let i = 0;
  let done = 0;

  async function worker() {
    while (i < targets.length) {
      const idx = i++;
      const word = targets[idx].word;
      const translation = await translateWord(word);
      state.cache.set(word, translation);
      if (onProgress) onProgress(++done, targets.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(TRANSLATE_CONCURRENCY, targets.length) }, worker)
  );
}

// The cards to show right now: top `count` words that have a translation,
// ordered by the active sort.
function visibleCards() {
  const cards = state.vocab
    .slice(0, state.count)
    .map((v) => ({ word: v.word, translation: state.cache.get(v.word) }))
    .filter((c) => c.translation);

  if (state.sort === "alpha") {
    cards.sort((a, b) => a.word.localeCompare(b.word, "da"));
  } else {
    for (let i = cards.length - 1; i > 0; i--) {       // Fisher–Yates shuffle
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }
  return cards;
}

// ---- Render ---------------------------------------------------------------

// Prepare the fetched page for embedding: inject a <base> so the site's own
// relative CSS/image/font URLs resolve back to the original domain (so it keeps
// its real look), and force links to open in a new tab.
function buildEmbedDoc(html, sourceUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc.head) return html;

  doc.querySelectorAll("base").forEach((b) => b.remove());
  const base = doc.createElement("base");
  base.href = sourceUrl;
  base.target = "_blank";
  doc.head.insertBefore(base, doc.head.firstChild);

  return "<!doctype html>" + doc.documentElement.outerHTML;
}

// Embed the original page inside a sandboxed iframe (no allow-scripts => the
// page's JS cannot run, so this stays safe with untrusted remote HTML). The
// site's stylesheets/images still load, so it looks like the real article.
function renderEmbed(html, sourceUrl) {
  els.body.classList.add("body--embed");
  els.body.innerHTML = "";

  const frame = document.createElement("iframe");
  frame.className = "embed-frame";
  frame.setAttribute("sandbox", "");          // scripts/forms/popups all disabled
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.loading = "lazy";
  frame.srcdoc = buildEmbedDoc(html, sourceUrl);
  els.body.appendChild(frame);
}

function renderOverview(article, html, sourceUrl) {
  els.title.textContent = article.title || "Untitled article";

  const metaBits = [];
  if (article.byline) metaBits.push(article.byline);
  if (article.siteName) metaBits.push(article.siteName);
  const words = (article.textContent.match(/\S+/g) || []).length;
  metaBits.push(`${words} words · ~${Math.max(1, Math.round(words / 200))} min read`);
  els.meta.textContent = metaBits.join(" · ");

  els.excerpt.textContent =
    article.excerpt || article.textContent.slice(0, 280).trim() + "…";

  renderEmbed(html, sourceUrl);

  els.overview.hidden = false;
}

function renderCards(cards) {
  els.cards.innerHTML = "";
  for (const { word, translation } of cards) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-inner">
        <div class="card-face card-front">
          <div class="word"></div>
          <div class="lang">DANSK</div>
        </div>
        <div class="card-face card-back">
          <div class="word"></div>
          <div class="lang">ENGLISH</div>
        </div>
      </div>`;
    card.querySelector(".card-front .word").textContent = word;
    card.querySelector(".card-back .word").textContent = translation;
    card.addEventListener("click", () => card.classList.toggle("flipped"));
    els.cards.appendChild(card);
  }
  els.cardsCount.textContent = `(${cards.length})`;
  els.cardsSection.hidden = false;
}

function rerender() {
  renderCards(visibleCards());
}

function setActiveSort(sort) {
  state.sort = sort;
  els.sortSwitch.querySelectorAll(".seg").forEach((b) =>
    b.classList.toggle("active", b.dataset.sort === sort)
  );
}

// ---- Main flow ------------------------------------------------------------

async function run() {
  const url = els.url.value.trim();
  if (!url) {
    status("Paste a Danish article URL first.", { error: true });
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error();
  } catch {
    status("That doesn't look like a valid URL.", { error: true });
    return;
  }

  els.go.disabled = true;
  els.overview.hidden = true;
  els.cardsSection.hidden = true;

  try {
    status("Fetching the article…", { busy: true });
    const html = await fetchHtml(url);

    status("Reading the article…", { busy: true });
    const article = extractArticle(html, url);
    renderOverview(article, html, url);

    state.vocab = buildVocab(article.textContent);
    state.cache = new Map();
    if (state.vocab.length === 0) throw new Error("No usable Danish words found.");

    // Configure controls now that we know how many words were parsed.
    state.count = Math.min(DEFAULT_COUNT, state.vocab.length);
    state.sort = "alpha";
    els.count.max = state.vocab.length;
    els.count.value = state.count;
    els.countVal.textContent = state.count;
    els.countMax.textContent = state.vocab.length;
    setActiveSort("alpha");

    status(`Translating vocabulary… 0/${state.count}`, { busy: true });
    await ensureTranslated(state.count, (done, total) => {
      status(`Translating vocabulary… ${done}/${total}`, { busy: true });
    });

    rerender();
    if (els.cards.children.length === 0)
      throw new Error("Translation service returned nothing. Try again.");
    clearStatus();
  } catch (e) {
    status(e.message || "Something went wrong.", { error: true });
  } finally {
    els.go.disabled = false;
  }
}

els.go.addEventListener("click", run);
els.url.addEventListener("keydown", (e) => {
  if (e.key === "Enter") run();
});

// Sort switch: A–Z vs Random. Reorders the already-translated cards only.
els.sortSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg");
  if (!btn || btn.dataset.sort === state.sort) return;
  setActiveSort(btn.dataset.sort);
  rerender();
});

// Slider: how many top words to translate. Live label on input; on release,
// translate any newly-needed words (cached ones are skipped) and re-render.
els.count.addEventListener("input", () => {
  els.countVal.textContent = els.count.value;
});
els.count.addEventListener("change", async () => {
  state.count = Number(els.count.value);
  els.go.disabled = true;
  els.count.disabled = true;
  try {
    status(`Translating vocabulary… 0/${state.count}`, { busy: true });
    await ensureTranslated(state.count, (done, total) => {
      status(`Translating vocabulary… ${done}/${total}`, { busy: true });
    });
    rerender();
    clearStatus();
  } catch {
    status("Translation failed. Try again.", { error: true });
  } finally {
    els.go.disabled = false;
    els.count.disabled = false;
  }
});
