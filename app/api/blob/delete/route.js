import { del } from "@vercel/blob";
import { NextResponse } from "next/server";

// Secret-protected blob cleanup endpoint, called by the n8n workflow AFTER each
// compliance PDF has been fetched and attached to Quickbase. Keeping the delete
// here (rather than calling the Vercel Blob REST API from n8n) keeps the
// BLOB_READ_WRITE_TOKEN in one place — the app — and uses the supported SDK.
//
// n8n authenticates with the `x-cleanup-secret` header (a Header Auth
// credential). Set BLOB_CLEANUP_SECRET in the Vercel project to the same value.
export async function DELETE(request) {
  const secret = process.env.BLOB_CLEANUP_SECRET;
  const provided = request.headers.get("x-cleanup-secret");
  if (!secret || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ ok: false, error: "Missing url." }, { status: 400 });
  }

  try {
    // del() is idempotent: it succeeds even if the blob no longer exists.
    await del(url);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Delete failed." },
      { status: 500 }
    );
  }
}
