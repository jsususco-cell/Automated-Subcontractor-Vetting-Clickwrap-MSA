import { NextResponse } from "next/server";

// TEMPORARY diagnostic — reports whether the Blob token reaches this deployment.
// Returns NO secret values: only a boolean, the token length, and the NAMES of
// env vars containing "BLOB" (to catch a custom-prefixed token). Remove after use.
export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  return NextResponse.json({
    hasBlobReadWriteToken: Boolean(token),
    tokenLength: token.length,
    blobEnvKeys: Object.keys(process.env).filter((k) => /BLOB/i.test(k)),
    vercelEnv: process.env.VERCEL_ENV || null,
  });
}
