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

## n8n workflow (Phase 3 — drafted)

`n8n/subcontractor-vetting.workflow.json` is an importable n8n workflow:
webhook → SAM.gov exclusions + Trade.gov CSL (OFAC) checks → build a Quickbase
record (fetching each Blob PDF and base64-attaching it) → create the record →
respond → delete the staging blobs. See **`n8n/README.md`** for import, the five
credentials, the Quickbase field-ID map, and the scoring formula.

Two notes on how it fits:

- **Scoring stays in Quickbase.** n8n only populates the *input* fields the
  Quickbase Formula-Numeric score reads — it does not compute the 0–100 itself.
- Blob cleanup calls back **`/api/blob/delete`** (secret-protected, uses the Blob
  SDK), so the `BLOB_READ_WRITE_TOKEN` stays in the app, in one place.

> **Nothing is provisioned yet** (no n8n instance, Quickbase app, or API keys),
> so the workflow ships with credential placeholders and dummy Quickbase FIDs.

## Phase 3 glue — done

`/api/submit` forwards the validated submission to the n8n webhook
(`N8N_WEBHOOK_URL`) with the `x-webhook-secret` header. If `N8N_WEBHOOK_URL` is
unset (n8n not provisioned yet) it logs and accepts, so the form still works in
dev. On a webhook failure it returns **502** so the applicant can retry rather
than silently dropping a submission. Contract: `n8n/README.md`.

## Not yet wired (next phases)

- **Phase 2 (remaining):** email verification (OTP/magic link) + CAPTCHA (Cloudflare Turnstile).

## Environment variables (added in later phases)

These go in Vercel project settings / n8n credentials — never commit them.

- `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob)
- `BLOB_CLEANUP_SECRET` (shared with n8n's "Blob Cleanup" credential)
- `TURNSTILE_SECRET_KEY`
- (n8n-side) `QUICKBASE_USER_TOKEN`, `SAM_GOV_API_KEY`, `TRADE_GOV_API_KEY`
