/**
 * Stage 3 manual probe: a FEW real GNews requests to learn the actual
 * response shape and test candidate queries (not part of CI).
 *
 *   npx tsx scripts/news-probe/gnews-probe.mts "<query>" [more queries...]
 *
 * - Reads GNEWS_API_KEY from .env.local (never printed, never written out).
 * - Fixed host https://gnews.io only; 1.2 s between requests (free plan: 1 req/s).
 * - Prints counts, publishers, titles and URLs; writes a shape-only sample
 *   (all text replaced by "<string>") to docs/news/samples/.
 * Each run costs one request per query from the 100/day free quota.
 */
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => [m[1], m[2]!.trim()]),
);
const key = env.GNEWS_API_KEY;
if (!key) {
  console.error("GNEWS_API_KEY missing in .env.local");
  process.exit(2);
}
const queries = process.argv.slice(2);
if (queries.length === 0 || queries.length > 6) {
  console.error("Pass 1-6 queries.");
  process.exit(2);
}

const OUT = path.resolve("docs/news/samples");
fs.mkdirSync(OUT, { recursive: true });
const to = new Date();
const from = new Date(to.getTime() - 14 * 86_400_000);
const shape = (v: unknown): unknown =>
  Array.isArray(v) ? v.slice(0, 1).map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v === "string" ? "<string>" : v;

for (const [i, q] of queries.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, 1200));
  const params = new URLSearchParams({ q, lang: "en", max: "10", sortby: "publishedAt", from: from.toISOString(), to: to.toISOString(), in: "title,description", nullable: "description,image,content" });
  const url = `https://gnews.io/api/v4/search?${params}`;
  const started = Date.now();
  const res = await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => null)) as { totalArticles?: number; articles?: { title: string; url: string; publishedAt: string; source?: { name?: string } }[]; errors?: unknown } | null;
  console.log(`\n== q=${q}  HTTP ${res.status}  ${Date.now() - started}ms  totalArticles=${body?.totalArticles ?? "?"}  returned=${body?.articles?.length ?? 0}`);
  if (!res.ok) console.log("   errors:", JSON.stringify(body?.errors));
  for (const a of body?.articles ?? []) console.log(`   ${a.publishedAt}  [${a.source?.name ?? "?"}]  ${a.title}\n      ${a.url}`);
  if (i === 0 && body) fs.writeFileSync(path.join(OUT, "search-response-shape.json"), JSON.stringify({ request: { endpoint: "https://gnews.io/api/v4/search", params: Object.fromEntries([...params].map(([k, v]) => [k, k === "q" ? v : k === "from" || k === "to" ? "<iso8601>" : v])) }, status: res.status, shape: shape(body) }, null, 2));
}
