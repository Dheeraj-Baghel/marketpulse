/**
 * Stage 3 news tests — MOCKED provider, no network.
 *
 * SYNTHETIC TEST FIXTURES: every headline, URL and publisher below is invented
 * for testing (e.g. "Example Wire", https://news.example.com/...). They mimic
 * the shape of real GNews responses (docs/news/FINDINGS.md) but are not real
 * news, are never shown in the app, and are not written to disk.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-news-"));
process.env.MARKETPULSE_DB_PATH = path.join(dir, "news-test.sqlite");

type M = {
  q: typeof import("../../src/lib/news/company-query");
  match: typeof import("../../src/lib/news/matching");
  norm: typeof import("../../src/lib/news/normalize");
  gnews: typeof import("../../src/lib/news/gnews-provider");
  svc: typeof import("../../src/lib/news/service");
  types: typeof import("../../src/lib/news/types");
  cfg: typeof import("../../src/lib/news/provider");
  db: import("../../src/db/client").Db;
};
let m: M;

const NOW = new Date("2026-10-22T12:00:00Z");
const daysAgo = (d: number, h = 0) => new Date(NOW.getTime() - d * 86_400_000 - h * 3_600_000).toISOString();
/** SYNTHETIC GNews article. */
const art = (title: string, o: Partial<{ id: string; description: string | null; url: string; publishedAt: string; source: string }> = {}) => ({
  id: o.id ?? `id-${title.length}-${title.slice(0, 6)}`,
  title,
  description: o.description ?? null,
  content: "truncated…",
  url: o.url ?? `https://news.example.com/${encodeURIComponent(title.slice(0, 20))}`,
  image: "https://img.example.com/x.jpg",
  publishedAt: o.publishedAt ?? daysAgo(1),
  lang: "en",
  source: { id: "ex", name: o.source ?? "Example Wire", url: "https://news.example.com", country: "in" },
});

before(async () => {
  const clientDb = await import("../../src/db/client");
  const schema = await import("../../src/db/schema");
  m = {
    q: await import("../../src/lib/news/company-query"),
    match: await import("../../src/lib/news/matching"),
    norm: await import("../../src/lib/news/normalize"),
    gnews: await import("../../src/lib/news/gnews-provider"),
    svc: await import("../../src/lib/news/service"),
    types: await import("../../src/lib/news/types"),
    cfg: await import("../../src/lib/news/provider"),
    db: clientDb.getDb(),
  };
  const [imp] = m.db
    .insert(schema.directoryImports)
    .values({ segment: "MAINBOARD", fileName: "SYNTHETIC_TEST.csv", fileSha256: "0".repeat(64), importedAt: "2026-01-01T00:00:00Z", rowsTotal: 1, rowsInserted: 1, rowsUpdated: 0, rowsUnchanged: 0, rowsRejected: 0, rowsDuplicate: 0, rowsDeactivated: 0 })
    .returning()
    .all();
  const base = { instrumentKind: "EQUITY_SHARE" as const, firstImportedAt: "2026-01-01", importedAt: "2026-01-01", lastImportId: imp!.id };
  // Real directory names (from the NSE list) for realistic matching; no prices involved.
  m.db.insert(schema.securities).values([
    { ...base, segment: "MAINBOARD", symbol: "TCS", name: "Tata Consultancy Services Limited", isin: "INE467B01029", issuerCode: "467B", series: "EQ" },
    { ...base, segment: "MAINBOARD", symbol: "ITC", name: "ITC Limited", isin: "INE154A01025", issuerCode: "154A", series: "EQ" },
    { ...base, segment: "MAINBOARD", symbol: "ITCHOTELS", name: "ITC Hotels Limited", isin: "INE379A01028", issuerCode: "379A", series: "EQ" },
    { ...base, segment: "MAINBOARD", symbol: "INFY", name: "Infosys Limited", isin: "INE009A01021", issuerCode: "009A", series: "EQ" },
    { ...base, segment: "MAINBOARD", symbol: "HAMPTON", name: "Hampton Sky Realty Limited", isin: "INE299D01022", issuerCode: "299D", series: "EQ" },
    { ...base, segment: "MAINBOARD", symbol: "HAMPTON", name: "Hampton Sky Realty Limited", isin: "INE299D01022", issuerCode: "299D", series: "BZ" },
    { ...base, segment: "SME", symbol: "EMKAYTOOLS", name: "Emkay Taps and Cutting Tools Limited", isin: "INE332S01011", issuerCode: "332S", series: "SM" },
  ]).run();
});

after(async () => {
  (await import("../../src/db/client")).closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** GNews provider wired to a fake fetch (no network). */
function fakeGNews(handler: (url: URL, init: RequestInit) => Response | Promise<Response>, over: Partial<{ apiKey: string | null; timeoutMs: number; dailyBudget: number }> = {}) {
  const calls: URL[] = [];
  const provider = new m.gnews.GNewsProvider({
    apiKey: over.apiKey === undefined ? "testkey1234567890abcd" : over.apiKey,
    timeoutMs: over.timeoutMs ?? 2000,
    dailyBudget: over.dailyBudget ?? 90,
    minIntervalMs: 0,
    now: () => NOW.getTime(),
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(input));
      calls.push(u);
      return handler(u, init ?? {});
    }) as typeof fetch,
  });
  return { provider, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const deps = (provider: InstanceType<M["gnews"]["GNewsProvider"]>, cache = m.svc.createNewsCache()) => ({ provider, cache, ttlMs: 7_200_000, lookbackDays: 14, now: () => NOW });

describe("company identity and query", () => {
  test("name normalisation drops suffixes without touching the legal name", () => {
    assert.equal(m.q.normalizeCompanyName("Tata Consultancy Services Limited"), "Tata Consultancy Services");
    assert.equal(m.q.normalizeCompanyName("Federal-Mogul Goetze (India) Limited."), "Federal-Mogul Goetze");
    assert.equal(m.q.normalizeCompanyName("HDFC Bank Ltd."), "HDFC Bank");
    assert.equal(m.q.normalizeCompanyName("Bank of Baroda"), "Bank of Baroda");
  });

  test("queries use the company name; symbols only via verified aliases with context", () => {
    const tcs = m.q.buildSearchProfile("TCS", "Tata Consultancy Services Limited", []);
    const q = m.q.buildGNewsQuery(tcs);
    assert.match(q, /^"Tata Consultancy Services" OR \("TCS" AND \(shares OR stock/);
    assert.ok(q.length <= 200);
    const itc = m.q.buildSearchProfile("ITC", "ITC Limited", ["ITC Hotels Limited"]);
    assert.equal(itc.ambiguousName, true);
    assert.deepEqual(itc.siblings, ["ITC Hotels"]);
    assert.ok(!m.q.buildGNewsQuery(itc).startsWith('"ITC" OR'), "bare ITC must never be an OR term");
    // A company without aliases: just its exact name (the symbol is NOT added).
    const sme = m.q.buildSearchProfile("EMKAYTOOLS", "Emkay Taps and Cutting Tools Limited", []);
    assert.equal(m.q.buildGNewsQuery(sme), '"Emkay Taps and Cutting Tools"');
  });

  test("acronym ambiguity: TCS tax, ITC trade body and sibling companies are rejected", () => {
    const tcs = m.q.buildSearchProfile("TCS", "Tata Consultancy Services Limited", []);
    const itc = m.q.buildSearchProfile("ITC", "ITC Limited", ["ITC Hotels Limited"]);
    const r = (p: typeof tcs, title: string, description: string | null = null) => m.match.matchArticle({ title, description }, p).relevance;
    assert.equal(r(tcs, "TCS shares jump 4% after Q2 results"), "verified");
    assert.equal(r(tcs, "Tata Consultancy Services wins European deal"), "verified");
    assert.equal(r(tcs, "New TCS rules on foreign remittances", "Tax collected at source (TCS) changes"), "rejected");
    assert.equal(r(tcs, "tcs shares"), "rejected"); // acronym must be upper case
    assert.equal(r(itc, "ITC shares rise 2% after stake sale"), "verified");
    assert.equal(r(itc, "International Trade Centre (ITC) report on exports"), "rejected");
    assert.equal(r(itc, "ITC Hotels Q2 revenue rises", "ITC Hotels Ltd posted..."), "rejected");
    assert.equal(r(itc, "ITC Hotels and ITC shares diverge"), "verified"); // ITC itself also named with context
  });
});

describe("normalisation", () => {
  test("GNews response parsing, invalid URLs and timestamps", () => {
    const { articles, invalid } = m.norm.parseGNewsArticles([
      art("Valid headline"),
      art("Script url", { url: "javascript:alert(1)" }),
      art("Local host", { url: "http://localhost:3000/x" }),
      art("Bare IP", { url: "http://10.0.0.1/x" }),
      art("Bad date", { publishedAt: "yesterday" }),
      art("No zone", { publishedAt: "2026-10-20T10:00:00" }),
      { title: 42 },
      art("<b>Tagged</b> &amp; spaced   title"),
    ]);
    assert.equal(articles.length, 2);
    assert.equal(invalid, 6);
    assert.equal(articles[1]!.title, "Tagged &amp; spaced title");
    assert.equal(m.norm.parsePublishedAt("2026-10-21T19:48:20Z"), "2026-10-21T19:48:20.000Z");
    assert.equal(m.norm.parsePublishedAt("2026-10-21T19:48:20+05:30"), "2026-10-21T14:18:20.000Z");
    assert.equal(m.norm.safeExternalUrl("https://user:pw@example.com/a"), null);
    assert.equal(m.norm.safeExternalUrl("https://www.livemint.com/a#frag"), "https://www.livemint.com/a");
  });

  test("rolling 14-day window and newest-first sorting", () => {
    const w = m.norm.rollingWindow(NOW, 14);
    assert.equal(w.to, NOW.toISOString());
    assert.equal(w.from, "2026-10-08T12:00:00.000Z");
    assert.ok(m.norm.inWindow(daysAgo(13, 23), w));
    assert.ok(!m.norm.inWindow(daysAgo(14, 1), w));
    assert.ok(!m.norm.inWindow(new Date(NOW.getTime() + 60_000).toISOString(), w));
    const sorted = [{ publishedAt: daysAgo(3) }, { publishedAt: daysAgo(1) }, { publishedAt: daysAgo(2) }].sort(m.norm.newestFirst);
    assert.deepEqual(sorted.map((s) => s.publishedAt), [daysAgo(1), daysAgo(2), daysAgo(3)]);
  });

  test("dedupe: id, canonical URL, amp/tracking variants, identical and near-identical titles", () => {
    const base = { publisher: "Example Wire", publishedAt: daysAgo(1) };
    const items = [
      { ...base, providerId: "a", url: "https://www.news.example.com/story-1?utm_source=x", title: "HDFC Bank begins probe into alleged internal data leak" },
      { ...base, providerId: "a", url: "https://news.example.com/other", title: "Different" }, // same id
      { ...base, providerId: "b", url: "https://news.example.com/story-1", title: "Something else" }, // same canonical URL
      { ...base, providerId: "c", url: "https://amp.news.example.com/story-1/amp", title: "x" }, // amp variant
      { ...base, providerId: "d", url: "https://news.example.com/e-paper/story", title: "HDFC Bank begins probe into alleged internal data leak" }, // identical title
      { ...base, providerId: "e", url: "https://news.example.com/s3", title: "HDFC Bank begins a probe into alleged internal data leak" }, // near-identical, same publisher
      { providerId: "f", publisher: "Other Daily", publishedAt: daysAgo(1, 5), url: "https://other.example.org/p", title: "HDFC Bank probes two executives over leak" }, // different story wording, other publisher: kept
    ];
    const { kept, removed } = m.norm.dedupeArticles(items);
    assert.deepEqual(kept.map((k) => k.providerId), ["a", "f"]);
    assert.equal(removed, 5);
  });
});

describe("GNews provider", () => {
  test("request: fixed host, key in header (not URL), documented params", async () => {
    let seenKey = "";
    const { provider, calls } = fakeGNews((_u, init) => {
      seenKey = new Headers(init.headers).get("x-api-key") ?? "";
      return json(200, { totalArticles: 0, articles: [] });
    });
    await provider.getCompanyNews({ companyId: "x", companyName: "Infosys Limited", symbol: "INFY", from: daysAgo(14), to: NOW.toISOString(), query: '"Infosys"' });
    const u = calls[0]!;
    assert.equal(`${u.origin}${u.pathname}`, "https://gnews.io/api/v4/search");
    assert.equal(u.searchParams.get("q"), '"Infosys"');
    assert.equal(u.searchParams.get("sortby"), "publishedAt");
    assert.equal(u.searchParams.get("max"), "10");
    assert.equal(u.searchParams.get("lang"), "en");
    assert.ok(u.searchParams.get("from") && u.searchParams.get("to"));
    assert.equal(u.searchParams.get("apikey"), null, "key must not be in the URL");
    assert.equal(seenKey, "testkey1234567890abcd");
  });

  test("missing key, 403 quota (blocks until 00:00 UTC), 429, 401, timeout, malformed", async () => {
    const req = { companyId: "x", companyName: "n", symbol: "INFY", from: daysAgo(14), to: NOW.toISOString(), query: '"Infosys"' };
    const code = async (p: InstanceType<M["gnews"]["GNewsProvider"]>) => p.getCompanyNews(req).then(() => "ok", (e: { code: string }) => e.code);
    assert.equal(await code(fakeGNews(() => json(200, {}), { apiKey: null }).provider), "NOT_CONFIGURED");
    const q = fakeGNews(() => json(403, { errors: ["You have reached your request limit for today"] }));
    assert.equal(await code(q.provider), "QUOTA_EXHAUSTED");
    assert.equal(await code(q.provider), "QUOTA_EXHAUSTED");
    assert.equal(q.calls.length, 1, "no further calls after a 403 until reset");
    assert.equal(q.provider.usage().blockedUntil, "2026-10-23T00:00:00.000Z");
    assert.equal(await code(fakeGNews(() => json(429, { errors: ["too many"] })).provider), "RATE_LIMITED");
    assert.equal(await code(fakeGNews(() => json(401, { errors: ["Invalid API Key provided."] })).provider), "PROVIDER_AUTH");
    assert.equal(await code(fakeGNews(() => json(503, {})).provider), "PROVIDER_UNAVAILABLE");
    assert.equal(await code(fakeGNews(() => json(200, { nope: true })).provider), "INVALID_RESPONSE");
    const slow = fakeGNews((_u, init) => new Promise<Response>((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 1000 });
    assert.equal(await code(slow.provider), "TIMEOUT");
    const budget = fakeGNews(() => json(200, { totalArticles: 0, articles: [] }), { dailyBudget: 1 });
    assert.equal(await code(budget.provider), "ok");
    assert.equal(await code(budget.provider), "QUOTA_EXHAUSTED"); // local budget guard
    assert.equal(budget.calls.length, 1);
  });

  test("config: key only from server env, never NEXT_PUBLIC; bad key -> not configured", () => {
    assert.equal(m.cfg.readNewsConfig({} as NodeJS.ProcessEnv).configured, false);
    assert.equal(m.cfg.readNewsConfig({ NEXT_PUBLIC_GNEWS_API_KEY: "abcdefghijklmnop1234" } as unknown as NodeJS.ProcessEnv).configured, false);
    assert.equal(m.cfg.readNewsConfig({ GNEWS_API_KEY: "abcdefghijklmnop1234" } as unknown as NodeJS.ProcessEnv).configured, true);
    assert.equal(m.cfg.readNewsConfig({ GNEWS_API_KEY: "has spaces in it!!" } as unknown as NodeJS.ProcessEnv).configured, false);
    assert.equal(m.cfg.readNewsConfig({ GNEWS_API_KEY: "abcdefghijklmnop1234", NEWS_PROVIDER: "other" } as unknown as NodeJS.ProcessEnv).configured, false);
    const c = m.cfg.readNewsConfig({ GNEWS_API_KEY: "abcdefghijklmnop1234", GNEWS_ENDPOINT_OVERRIDE: "https://evil.example.com" } as unknown as NodeJS.ProcessEnv);
    assert.equal(c.endpoint, "https://gnews.io/api/v4/search", "only loopback test doubles may override the host");
    assert.equal(m.cfg.readNewsConfig({ NEWS_LOOKBACK_DAYS: "90" } as unknown as NodeJS.ProcessEnv).lookbackDays, 14);
  });
});

describe("news service", () => {
  test("relevant, in-window, de-duplicated, newest first; irrelevant and old rejected", async () => {
    const { provider } = fakeGNews(() =>
      json(200, {
        totalArticles: 250,
        articles: [
          art("TCS shares climb after Q2 earnings beat", { publishedAt: daysAgo(2), id: "1" }),
          art("Tata Consultancy Services signs AI deal with European bank", { publishedAt: daysAgo(0, 3), id: "2" }),
          art("New TCS rules for foreign remittances explained", { description: "Tax collected at source (TCS)...", id: "3" }),
          art("TCS shares climb after Q2 earnings beat", { publishedAt: daysAgo(2), id: "4", url: "https://news.example.com/e-paper/tcs" }),
          art("Tata Consultancy Services Q1 recap", { publishedAt: daysAgo(20), id: "5" }),
          art("Market wrap: Nifty ends higher", { description: "Top gainers included Tata Consultancy Services", id: "6", publishedAt: daysAgo(1) }),
        ],
      }),
    );
    const r = await m.svc.getCompanyNews({ symbol: "TCS", series: null }, deps(provider));
    assert.equal(r.state, "ok");
    assert.deepEqual(r.articles.map((a) => a.title), ["Tata Consultancy Services signs AI deal with European bank", "Market wrap: Nifty ends higher", "TCS shares climb after Q2 earnings beat"]);
    assert.deepEqual(r.articles.map((a) => a.relevance), ["verified", "likely", "verified"]);
    assert.equal(r.rejectedCount, 2); // TCS tax + out-of-window
    assert.equal(r.duplicateCount, 1);
    assert.equal(r.totalMatches, 250);
    assert.equal(r.company.name, "Tata Consultancy Services Limited");
    assert.ok(!JSON.stringify(r).includes("testkey"), "key must never appear in responses");
  });

  test("empty results are an explicit 'empty' success (SME with no coverage)", async () => {
    const { provider, calls } = fakeGNews(() => json(200, { totalArticles: 0, articles: [] }));
    const r = await m.svc.getCompanyNews({ symbol: "EMKAYTOOLS", series: null }, deps(provider));
    assert.equal(r.state, "empty");
    assert.equal(r.articles.length, 0);
    assert.equal(calls[0]!.searchParams.get("q"), '"Emkay Taps and Cutting Tools"');
  });

  test("not configured is explicit (no provider call)", async () => {
    const { provider, calls } = fakeGNews(() => json(200, {}), { apiKey: null });
    const r = await m.svc.getCompanyNews({ symbol: "INFY", series: null }, deps(provider));
    assert.equal(r.state, "not-configured");
    assert.equal(r.message, "News provider not configured.");
    assert.equal(calls.length, 0);
  });

  test("cache TTL, empty-result caching, refresh, concurrent single-flight", async () => {
    let t = NOW.getTime();
    let clock = 0;
    const { provider, calls } = fakeGNews(() => json(200, { totalArticles: 0, articles: [] }));
    const { TtlCache } = await import("../../src/lib/market-data/cache");
    const cache = new TtlCache<import("../../src/lib/news/service").NewsCacheEntry>(10, () => clock);
    const d = { provider, cache, ttlMs: 7_200_000, lookbackDays: 14, now: () => new Date(t) };
    await Promise.all([1, 2, 3].map(() => m.svc.getCompanyNews({ symbol: "INFY", series: null }, d)));
    assert.equal(calls.length, 1, "concurrent requests share one provider call");
    const again = await m.svc.getCompanyNews({ symbol: "INFY", series: null }, d);
    assert.equal(again.cached, true);
    assert.equal(calls.length, 1, "empty result cached within TTL");
    await m.svc.getCompanyNews({ symbol: "INFY", series: null, refresh: true }, d);
    assert.equal(calls.length, 2, "manual refresh bypasses the cache");
    clock += 7_200_001; // TTL elapsed
    t += 7_200_001;
    const expired = await m.svc.getCompanyNews({ symbol: "INFY", series: null }, d);
    assert.equal(expired.cached, false);
    assert.equal(calls.length, 3, "empty-result cache entry expires after the TTL");
  });

  test("cached articles are re-filtered against the CURRENT rolling window", async () => {
    let now = NOW;
    const { provider } = fakeGNews(() => json(200, { totalArticles: 1, articles: [art("Infosys wins large deal", { publishedAt: daysAgo(13) })] }));
    const cache = m.svc.createNewsCache();
    const d = { provider, cache, ttlMs: 7 * 86_400_000, lookbackDays: 14, now: () => now };
    assert.equal((await m.svc.getCompanyNews({ symbol: "INFY", series: null }, d)).articles.length, 1);
    now = new Date(NOW.getTime() + 2 * 86_400_000); // two days later, still cached
    const later = await m.svc.getCompanyNews({ symbol: "INFY", series: null }, d);
    assert.equal(later.cached, true);
    assert.equal(later.articles.length, 0, "article is now older than 14 days");
    assert.equal(later.state, "empty");
  });

  test("quota exhausted after a successful fetch shows stale cached articles with the ORIGINAL fetch time", async () => {
    let fail = false;
    const { provider } = fakeGNews(() => (fail ? json(403, { errors: ["limit"] }) : json(200, { totalArticles: 1, articles: [art("Infosys wins large deal")] })));
    const cache = m.svc.createNewsCache();
    const first = await m.svc.getCompanyNews({ symbol: "INFY", series: null }, deps(provider, cache));
    fail = true;
    const stale = await m.svc.getCompanyNews({ symbol: "INFY", series: null, refresh: true }, deps(provider, cache));
    assert.equal(stale.state, "stale");
    assert.equal(stale.staleReason, "quota-exhausted");
    assert.equal(stale.fetchedAt, first.fetchedAt);
    assert.match(stale.message!, /^Daily news API limit reached/);
    assert.equal(stale.articles.length, 1);
    // Without cache: explicit quota state, never "empty".
    const none = await m.svc.getCompanyNews({ symbol: "TCS", series: null }, deps(provider, cache));
    assert.equal(none.state, "quota-exhausted");
    assert.equal(none.retryAfter, "2026-10-23T00:00:00.000Z");
  });

  test("provider outage is 'unavailable', not 'empty'; unknown symbol rejected before any call", async () => {
    const { provider, calls } = fakeGNews(() => json(500, {}));
    const r = await m.svc.getCompanyNews({ symbol: "INFY", series: null }, deps(provider));
    assert.equal(r.state, "unavailable");
    await assert.rejects(m.svc.getCompanyNews({ symbol: "NOSUCH", series: null }, deps(provider)), (e: { code?: string }) => e.code === "UNKNOWN_SECURITY");
    assert.equal(calls.length, 1);
  });

  test("no article leakage between companies (separate cache keys); multi-series symbol is one company", async () => {
    const { provider, calls } = fakeGNews((u) => {
      const q = u.searchParams.get("q") ?? "";
      return json(200, { totalArticles: 1, articles: [q.includes("Infosys") ? art("Infosys raises guidance", { id: "i" }) : art("ITC shares rise on stake sale", { id: "t" })] });
    });
    const cache = m.svc.createNewsCache();
    const [infy, itc] = await Promise.all([m.svc.getCompanyNews({ symbol: "INFY", series: null }, deps(provider, cache)), m.svc.getCompanyNews({ symbol: "ITC", series: null }, deps(provider, cache))]);
    assert.deepEqual(infy.articles.map((a) => a.title), ["Infosys raises guidance"]);
    assert.deepEqual(itc.articles.map((a) => a.title), ["ITC shares rise on stake sale"]);
    assert.equal(calls.length, 2);
    const h1 = await m.svc.getCompanyNews({ symbol: "HAMPTON", series: null }, deps(provider, cache));
    const h2 = await m.svc.getCompanyNews({ symbol: "HAMPTON", series: "BZ" }, deps(provider, cache));
    assert.equal(h1.company.symbol, "HAMPTON");
    assert.equal(h2.cached, true, "same company across series shares one cache entry");
  });
});
