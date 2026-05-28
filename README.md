# Subcontractor Vetting & Clickwrap MSA

Custom intake form for Byrdson Services' automated subcontractor prequalification
and Master Services Agreement (MSA) clickwrap.

## Stack

- **Next.js (App Router)** — deployed on **Vercel**, source on **GitHub**.
- Compliance PDFs are uploaded to **Quickbase native file-attachment fields**.
- **n8n** orchestrates SAM.gov + OFAC (Trade.gov CSL) checks and the Quickbase write.

> No Node toolchain is installed on the build author's machine. Do not expect
> local `npm install` / `next dev`. Pushes to GitHub trigger a **Vercel cloud
> build** — that is the canonical way to build and preview this app.

## What exists now (Phase 0/1 scaffold)

- `app/apply` — five-section intake form (Company & Capacity, Compliance Uploads,
  References, MSA clickwrap, Binding Execution).
- `app/api/submit` — stub endpoint with server-side validation.
- `lib/msa.js` — **placeholder** MSA text; replace with the final legal clauses.

## File uploads (Phase 2 — done)

Compliance PDFs upload directly from the browser to **Vercel Blob** via
`/api/blob/upload` (client-direct upload, which bypasses the serverless body
limit). The submit payload includes `documents: [{ key, url, filename }]`.

**Setup required:** in the Vercel project, create a **Blob store** and connect it
to this project (Storage → Blob → Connect). That sets `BLOB_READ_WRITE_TOKEN`.
Without it, uploads return a token error.

> Privacy note: blobs are stored with `access: "public"` and an unguessable
> random suffix, as a short-lived staging area. Phase 3's n8n flow must fetch
> each blob, attach it to Quickbase, then **delete** the blob promptly.

## Not yet wired (next phases)

- **Phase 2 (remaining):** email verification (OTP/magic link) + CAPTCHA (Cloudflare Turnstile).
- **Phase 3:** forward submission + blob URLs to the n8n webhook.
- **Phase 3:** SAM.gov exclusions + Trade.gov CSL (OFAC) checks; Quickbase record
  creation with file attachments, then blob cleanup.

## Environment variables (added in later phases)

These go in Vercel project settings / n8n credentials — never commit them.

- `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob)
- `TURNSTILE_SECRET_KEY`
- (n8n-side) `QUICKBASE_USER_TOKEN`, `SAM_GOV_API_KEY`, `TRADE_GOV_API_KEY`
