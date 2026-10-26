import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { isPublicPreview } from "../../src/lib/public-preview";
import { readMcpConfig } from "../../src/lib/market-data/nse-mcp-client";
import { readMarketDataConfig } from "../../src/lib/market-data/provider";
import { readNewsConfig } from "../../src/lib/news/provider";
import { closeDb, getDb, resolveDbPath } from "../../src/db/client";
import { securities } from "../../src/db/schema";
import { GET as prices } from "../../src/app/api/prices/route";
import { GET as quotes } from "../../src/app/api/quotes/route";
import { GET as news } from "../../src/app/api/news/route";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
afterEach(() => {
  closeDb(); globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

test("public preview is fail-closed on Vercel while normal local mode stays available", () => {
  assert.equal(isPublicPreview({ NODE_ENV: "production" }), false);
  assert.equal(isPublicPreview({ NODE_ENV: "production", MARKETPULSE_PUBLIC_PREVIEW: "true" }), true);
  assert.equal(isPublicPreview({ NODE_ENV: "production", VERCEL: "1", MARKETPULSE_PUBLIC_PREVIEW: "false" }), true);
});

test("public provider policy overrides enable flags, source overrides and a configured news key", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", VERCEL: "1", ENABLE_NSE_MCP: "true", MARKET_DATA_SOURCE: "nse-mcp", GNEWS_API_KEY: "a".repeat(32), NEWS_PROVIDER: "gnews" };
  assert.equal(readMcpConfig(env).enabled, false);
  const market = readMarketDataConfig(env);
  assert.equal(market.mcpEnabled, false); assert.equal(market.allowSourceOverride, false);
  assert.equal(market.quoteAutoRefreshMs, 0);
  const config = readNewsConfig(env);
  assert.equal(config.configured, false); assert.equal(config.apiKey, null);
});

test("public DB never opens a configured local file and has no imported securities", () => {
  process.env.MARKETPULSE_PUBLIC_PREVIEW = "true";
  process.env.MARKETPULSE_DB_PATH = "/must-not-open-this-user-database.sqlite";
  assert.equal(resolveDbPath(), ":memory:");
  assert.deepEqual(getDb().select().from(securities).all(), []);
});

for (const [name, handler] of [["prices", prices], ["quotes", quotes], ["news", news]] as const) {
  test(`public ${name} endpoint returns an honest 503 without contacting a provider`, async () => {
    process.env.VERCEL = "1";
    process.env.ENABLE_NSE_MCP = "true";
    process.env.GNEWS_API_KEY = "a".repeat(32);
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new Error("Public provider call forbidden"); }) as typeof fetch;
    const response = await handler(new NextRequest(`https://preview.invalid/api/${name}?symbol=RELIANCE&refresh=1&source=nse-mcp`));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).code, "PUBLIC_DATA_LICENSE_REQUIRED");
    assert.equal(calls, 0);
  });
}
