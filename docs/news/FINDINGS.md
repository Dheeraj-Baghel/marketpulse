# GNews findings (Stage 3)

Probed on **22 Oct 2026, ~17:55 UTC**, using the user's free-plan key from
`.env.local`. That file is git-ignored; the key was never printed or committed.
I used [gnews-probe.mts](../../scripts/news-probe/gnews-probe.mts). There were
**6 requests** in total, spaced 1.2 s apart, out of 100/day.

Official references read:

- [Search endpoint](https://docs.gnews.io/endpoints/search-endpoint)
- [Query syntax](https://docs.gnews.io/query-syntax)
- [Error handling](https://docs.gnews.io/error-handling)
- [Terms of service](https://gnews.io/legal/terms-of-service)

## API contract (verified)

`GET https://gnews.io/api/v4/search`, with the key sent in the `X-Api-Key`
header (documented alternative to `apikey`, which keeps it out of URLs and
logs).

**Parameters used:**

- `q`: max 200 chars; `"phrase"` for exact match; `AND`/`OR`/`NOT`; `OR`
  binds tighter than `AND`, so use parentheses.
- `lang=en`
- `max=10` (free-plan maximum per request)
- `sortby=publishedAt`
- `from`/`to` in ISO 8601
- `in=title,description` (the default)
- `nullable=description,image,content`

**Response:**

```
{ information?: {...}, totalArticles: number,
  articles: [{ id, title, description, content, url, image, publishedAt, lang,
               source: { id, name, url, country } }] }
```

Shape only: [samples/search-response-shape.json](samples/search-response-shape.json).
The free plan truncates `content`, and `publishedAt` is ISO UTC (`...Z`).

**Errors** are returned as `{ "errors": [...] }` or `{ "errors": { attr: msg } }`:

| Status | Meaning | MarketPulse handling |
| --- | --- | --- |
| 400 | bad request (also a missing key) | invalid request; never shown as "no news" |
| 401 | invalid key | `PROVIDER_AUTH` |
| 403 | daily quota reached, resets 00:00 UTC | `QUOTA_EXHAUSTED`; no calls until reset |
| 429 | over 1 request/second | `RATE_LIMITED`; short cool-down |
| 5xx | provider outage | `PROVIDER_UNAVAILABLE` |

**Free plan:** 100 requests/day, 10 articles/request, 1 request/s, about a
12-hour delay, 30-day history, non-commercial use.

## Real results (14-day window, lang=en)

| Company | Query probed | totalArticles | Observations |
| --- | --- | --- | --- |
| RELIANCE | `"Reliance Industries"` | 290 | Several hits only say "Ambani", "RIL" or "Jamnagar refinery". One ET story is syndicated twice (front page + e-paper URL) with an identical title. |
| TCS | `"Tata Consultancy Services" OR TCS` | 399 | Bare `TCS` is noisy: sector roundups and IT-jobs stories where TCS is one of many. |
| INFY | `"Infosys"` | 263 | Clean, but market wraps and sector pieces name it in passing. |
| HDFCBANK | `"HDFC Bank"` | 262 | Clean; several outlets report the same probe story (distinct publishers, so kept). Market-wrap headlines may not name the bank. |
| ITC | `"ITC Limited" OR "ITC Ltd" OR "ITC shares"` | **2** | Phrase-only is far too narrow. ITC also collides with *ITC Hotels* (a separate listed company), ITC (International Trade Centre), etc. |
| EMKAYTOOLS (SME) | `"Emkay Taps"` | **0** | Typical for small SME issuers: no coverage in the provider. |

## Consequences for the design

1. **Query by verified company name, not the symbol.** Use the bare symbol only
   where it is an established, verified alias (TCS, ITC), and require
   relevance checks locally.
2. **Local relevance matching is mandatory.** The API matches keywords
   anywhere in title/description, and results include market wraps and sibling
   companies (Reliance Power, ITC Hotels, HDFC Life) that must not be shown as
   the selected company's news.
3. **Deduplicate** syndicated copies by canonical URL, then by near-identical
   title from the same publisher.
4. **Coverage is uneven.** Large caps return 250+ matches (only 10 retrieved
   per request on the free plan). Most SME issuers return none. The UI states
   both facts and never implies "no news exists".

## Terms (excerpts from gnews.io/legal/terms-of-service, read 22 Oct 2026)

- Free plan: "personal, academic, evaluation, and other non-commercial use"
  only. "Developing, testing, and evaluating an integration that has not been
  published or put into production is not a commercial purpose."
- No exceeding rate limits or quotas, and no redistributing access to the API.
- Images and media may be copyrighted by third parties, so **MarketPulse does
  not display article images**.
- "You must not represent that API data originated from you", so publisher
  and provider are always attributed.
- Caching or storage on the free plan is neither explicitly granted nor
  prohibited for non-commercial use. **MarketPulse therefore keeps news in a
  transient in-memory cache only (2 h TTL) and never writes articles to
  SQLite.**
