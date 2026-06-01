import { handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";

// Issues short-lived client tokens so the browser can upload PDFs directly to
// Vercel Blob, bypassing the serverless request-body size limit. Requires a
// Blob store connected to the project (sets BLOB_READ_WRITE_TOKEN).
export async function POST(request) {
  const body = await request.json();

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => ({
        // PDFs are the compliance docs; PNG is the drawn signature image.
        allowedContentTypes: ["application/pdf", "image/png"],
        maximumSizeInBytes: 10 * 1024 * 1024,
        addRandomSuffix: true,
        tokenPayload: clientPayload ?? null,
      }),
      // Fires server-side after the upload finishes. Phase 3 will trigger the
      // n8n fetch + Quickbase attach from the submit handler instead.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Upload token error." },
      { status: 400 }
    );
  }
}
