/**
 * Local SYNTHETIC GNews test double for the automated browser suite.
 * Mimics GET /api/v4/search (shape verified in docs/news/FINDINGS.md) so the
 * app's real GNews provider code runs without spending the 100/day quota.
 *
 * ALL ARTICLES HERE ARE INVENTED (TEST-ONLY): headlines contain "[TEST]",
 * publishers are "Example Wire"/"Sample Daily", URLs are on example.com.
 *
 * Control: POST /__control {mode: "ok" | "quota" | "down" | "slow", delayMs?}
 */
import http from "node:http";

type Mode = "ok" | "quota" | "down" | "slow";
const state: { mode: Mode; delayMs: Record<string, number>; calls: Record<string, number>; lastKeyHeader: string | null; lastHadKeyInUrl: boolean } = {
  mode: "ok",
  delayMs: {},
  calls: {},
  lastKeyHeader: null,
  lastHadKeyInUrl: false,
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const art = (id: string, title: string, description: string | null, h: number, publisher = "Example Wire") => ({
  id,
  title,
  description,
  content: "Synthetic content, truncated...",
  url: `https://news.example.com/${id}`,
  image: "https://img.example.com/never-shown.jpg",
  publishedAt: hoursAgo(h),
  lang: "en",
  source: { id: "ex", name: publisher, url: "https://news.example.com", country: "in" },
});

/** Synthetic corpus per query keyword; includes deliberate traps for the matcher. */
function articlesFor(q: string) {
  if (q.includes("Reliance Industries")) {
    return [
      art("rel-1", "[TEST] Reliance Industries shares rise after refinery update", "Reliance Industries said...", 5),
      art("rel-2", "[TEST] RIL board approves expansion plan", null, 30, "Sample Daily"),
      art("rel-3", "[TEST] Reliance Power shares jump on debt deal", "Reliance Power, an Anil Ambani group firm...", 8), // sibling: reject
      art("rel-4", "[TEST] Reliance Industries shares rise after refinery update", "Syndicated copy", 5), // duplicate title: drop
      art("rel-5", "[TEST] Reliance Industries Q1 recap", null, 24 * 20), // outside 14 days: reject
    ];
  }
  if (q.includes("Tata Consultancy Services")) {
    return [
      art("tcs-1", "[TEST] TCS shares gain after large deal win", null, 3),
      art("tcs-2", "[TEST] New TCS rules on foreign remittances", "Tax collected at source (TCS) changes from April", 4), // tax TCS: reject
      art("tcs-3", "[TEST] Tata Consultancy Services opens new delivery centre", "The IT major...", 50),
    ];
  }
  if (q.includes("Infosys")) return [art("inf-1", "[TEST] Infosys raises revenue guidance", "Infosys said...", 6)];
  return []; // e.g. SME names: no coverage
}

export function startGNewsDouble(port: number): Promise<{ close: () => Promise<void>; state: typeof state }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/__control" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { mode?: Mode; delayMs?: Record<string, number>; reset?: boolean };
      if (body.reset) {
        state.mode = "ok";
        state.delayMs = {};
      }
      if (body.mode) state.mode = body.mode;
      if (body.delayMs) state.delayMs = { ...state.delayMs, ...body.delayMs };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
      return;
    }
    if (url.pathname !== "/api/v4/search") return void res.writeHead(404).end();
    const q = url.searchParams.get("q") ?? "";
    state.calls[q] = (state.calls[q] ?? 0) + 1;
    state.lastKeyHeader = req.headers["x-api-key"] ? "present" : null;
    state.lastHadKeyInUrl = url.searchParams.has("apikey");
    const key = Object.keys(state.delayMs).find((k) => q.includes(k));
    if (key) await new Promise((r) => setTimeout(r, state.delayMs[key]));
    if (state.mode === "slow") await new Promise((r) => setTimeout(r, 15_000));
    if (state.mode === "quota") {
      return void res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ errors: ["You have reached your request limit for today, the next reset will be tomorrow at midnight UTC."] }));
    }
    if (state.mode === "down") return void res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ errors: ["maintenance"] }));
    const articles = articlesFor(q);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ totalArticles: articles.length * 25, articles }));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ state, close: () => new Promise<void>((r) => server.close(() => r())) })));
}
