# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Static, zero-build webpage (HTML/CSS/vanilla JS) that turns a Danish news article URL into
English vocabulary flashcards. Deployed on GitHub Pages. No backend, no bundler, no API keys.

## Run / deploy

- Local: `python -m http.server 8000` then open `http://localhost:8000`.
  Do **not** open via `file://` — the `fetch` calls require an http(s) origin.
- Deploy: GitHub Pages, "Deploy from a branch", `/ (root)`. Empty `.nojekyll` disables Jekyll.
- No build, no tests, no lint config. Edits to the `.js`/`.css`/`.html` are live on reload.

## Hard constraints (do not violate)

- **No backend and no Claude/LLM dependency** for parsing or translation — this is the core
  design rule. All work happens client-side via third-party HTTP APIs.
- Must stay deployable as a plain static site (no Node build step).

## Architecture (pipeline in `app.js`)

`run()` orchestrates four stages; each has a dedicated function:

1. `fetchHtml(url)` — GitHub Pages can't fetch cross-origin pages (browser CORS block), so
   raw HTML is relayed through public CORS proxies in the `PROXIES` array, tried in order
   until one succeeds. **This is the most fragile part** — proxy outages are the usual cause
   of "could not fetch" failures; the fix is rotating/adding proxies.
2. `extractArticle(html, url)` — Mozilla **Readability** (loaded via CDN `<script>` in
   `index.html`, exposes global `Readability`) parses the HTML `Document` into clean
   `{ title, byline, excerpt, textContent, ... }`. A `<base>` is injected so relative links resolve.
3. `buildVocab(text)` — tokenizes, drops `window.DANISH_STOPWORDS` (defined in `stopwords.js`),
   ranks by frequency, returns top `MAX_CARDS` words.
4. `translateAll(vocab)` — translates each word da→en via the free **MyMemory** API with a
   small concurrency pool (`TRANSLATE_CONCURRENCY`). MyMemory echoes the input when it has no
   translation; those are filtered out.

Tuning knobs are the consts at the top of `app.js` (`MAX_CARDS`, `MIN_WORD_LEN`,
`TRANSLATE_CONCURRENCY`, `PROXIES`, `TRANSLATE_URL`).

## Files

- `index.html` — markup + CDN script tag for Readability; loads `stopwords.js` then `app.js`.
- `app.js` — entire pipeline + rendering (overview section, flip-card grid).
- `stopwords.js` — Danish stopword Set, kept separate so the list can grow without touching logic.
- `styles.css` — Dannebrog-themed styling; flip cards use CSS `transform: rotateY` + `.flipped`.

## Gotchas

- Switching translation provider means changing `TRANSLATE_URL` **and** the response-parsing
  in `translateWord` (each API has a different JSON shape).
- Rendering uses `textContent` (not `innerHTML`) for article body and card words on purpose —
  the input is untrusted remote HTML.
