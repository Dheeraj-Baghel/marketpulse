// The user explicitly requested real hosted data, matching localhost.
// Enable only in the dedicated deployment's server environment. Secrets never
// reach NEXT_PUBLIC variables. Preview mode remains a safe explicit fallback.
// Successful provider access is not a claim of public redistribution licensing.
export function isPublicPreview(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MARKETPULSE_PUBLIC_PREVIEW === "true") return true;
  return env.VERCEL === "1" && env.MARKETPULSE_REAL_DATA_ENABLED !== "true";
}

export const PUBLIC_PREVIEW_MESSAGE =
  "Server data access is not enabled for this deployment. Configure the approved server-side data mode to use the directory, historical prices, delayed quotes and company news.";
