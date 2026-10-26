// Verify source behavior in an isolated child environment; do not modify the
// app's deployment env or touch the user's SQLite database/credentials.
// Unit tests exercise BOTH local and public-preview policy themselves.
import { spawnSync } from 'node:child_process';
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (name === 'VERCEL' || name === 'MARKETPULSE_PUBLIC_PREVIEW' || name === 'MARKETPULSE_DB_PATH'
    || name === 'MARKETPULSE_REAL_DATA_ENABLED' || name === 'MARKETPULSE_DB_READONLY'
    || name.startsWith('NSE_') || name.startsWith('GNEWS_') || name.startsWith('NEWS_')
    || name.startsWith('MARKETPULSE_ALLOW_') || name === 'ENABLE_NSE_MCP' || name === 'MARKET_DATA_SOURCE') delete env[name];
}
for (const script of ['lint', 'typecheck', 'test']) {
  const result = spawnSync('npm', ['run', script], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
