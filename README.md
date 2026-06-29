# 🇩🇰 Dansk Flashcards

A friendly static webpage that turns a Danish news article into English vocabulary flashcards.

Paste a URL → see an **overview** of the article on top, and **flip-card flashcards** of the
most frequent Danish words (translated to English) on the bottom.

No backend, no API keys, no Claude — everything runs in the browser.

## How it works

1. **Fetch** — the article HTML is pulled through a public CORS proxy (GitHub Pages can't
   fetch third-party URLs directly because the browser blocks cross-origin requests).
2. **Extract** — [Mozilla Readability](https://github.com/mozilla/readability) strips nav/ads
   and returns clean title + body text.
3. **Vocabulary** — the text is tokenized, Danish stopwords removed, and the top ~24 words
   by frequency are selected.
4. **Translate** — each word is translated da→en via the free
   [MyMemory](https://mymemory.translated.net/) API and rendered as a flip card.

## Run locally

It's static — just serve the folder:

```sh
python -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` via `file://` will fail: the proxy/translation `fetch` calls need an
`http(s)` origin.

## Deploy to GitHub Pages

Push to GitHub, then **Settings → Pages → Source: Deploy from a branch**, pick your branch
and `/ (root)`. The site is served as-is (the empty `.nojekyll` disables Jekyll processing).

## Limitations

- Public CORS proxies and the free translation API have rate limits and occasional downtime.
  Reliability depends on third-party services.
- Single-word translations lack sentence context, so some are approximate — fine for vocab,
  not for grammar.
