// User selected a public website, not upload of the existing NSE database.
// Keep the public deployment data-disabled pending redistribution permission.
// Vercel is fail-closed even if provider enable flags are accidentally changed;
// a future licensed deployment requires an explicit reviewed code change.
export function isPublicPreview(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MARKETPULSE_PUBLIC_PREVIEW === "true" || env.VERCEL === "1";
}

export const PUBLIC_PREVIEW_MESSAGE =
  "Market data and company news are disabled on this public preview pending public-display licensing. No local database has been uploaded.";
