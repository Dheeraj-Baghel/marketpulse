import { NextResponse } from "next/server";
import { isPublicPreview, PUBLIC_PREVIEW_MESSAGE } from "./public-preview";

/** Fail before parsing symbols, opening a DB or contacting any external service. */
export function publicPreviewResponse(): NextResponse | null {
  if (!isPublicPreview()) return null;
  return NextResponse.json(
    { state: "disabled", code: "PUBLIC_DATA_LICENSE_REQUIRED", message: PUBLIC_PREVIEW_MESSAGE },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
