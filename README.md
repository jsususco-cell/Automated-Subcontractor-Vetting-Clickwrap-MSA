# Subcontractor Vetting & Clickwrap MSA

Automated subcontractor **prequalification + Master Services Agreement (MSA)
clickwrap** for Byrdson Services. A contractor fills out one public form; the
system runs federal background screening, captures a legally-binding MSA
acceptance with drawn signatures, and writes a scored, document-complete record
into Quickbase for a compliance reviewer.

- **Live form:** https://automated-subcontractor-vetting-cli.vercel.app/apply
- **Stack:** Next.js (App Router) on **Vercel** · **Vercel Blob** (file staging)
  · **n8n** (orchestration) · **Quickbase** (system of record) · **Cloudflare
  Turnstile** + **Resend** (anti-abuse) · **SAM.gov** + **Trade.gov CSL/OFAC**
  (federal screening).

> **Build note:** there is no local Node toolchain. Don't expect
> `npm install` / `next dev`. Pushing to GitHub `main` triggers a **Vercel cloud
> build + production deploy** — that is the canonical way to build, preview, and
> ship this app.

---

## End-to-end workflow

```
APPLICANT (browser)                          BYRDSON INFRASTRUCTURE
───────────────────                          ──────────────────────
1. Open /apply
2. Fill company / capacity / contacts
3. Pass anti-abuse ───────────────────────►  Turnstile siteverify + email OTP
   (CAPTCHA + emailed 6-digit code)          (Resend sends the code)
4. Upload compliance PDFs ────────────────►  Vercel Blob (public, staging)
5. Read full MSA (scroll-gated) +
   draw signature(s)
6. Submit ────────────────────────────────►  POST /api/submit
                                               ├─ re-validate fields
                                               ├─ re-verify Turnstile + OTP
                                               ├─ upload signature PNGs → Blob
                                               └─ forward payload → n8n webhook
                                                  (x-webhook-secret)
                                                        │
   ┌────────────────────────────────────────────────────┘
   ▼  n8n workflow  (https://n8n.byrdsonservices.com)
   Webhook
     → Config & Prepare        (non-secret config + Quickbase field map)
     → SAM.gov Exclusions       (federal debarment check)
     → Trade.gov CSL            (OFAC + Commerce/State sanctions check)
     → Evaluate Screening       (turn results into Quickbase scoring INPUTS)
     → Build Quickbase Record   (fetch each Blob PDF, base64-attach it)
     → Quickbase: Create Record (POST api.quickbase.com/v1/records)
     → Shape Response           (success keyed off createdRecordIds)
     → Respond to Webhook ──────────────────► { ok, recordId, flagged, screening }
     → Split Documents → Delete Staging Blob  (callback /api/blob/delete)
                                                        │
   ┌────────────────────────────────────────────────────┘
   ▼  Quickbase  (app buskqh26r · table bv32ejcgp)
   Record created with: company data, document attachments, signatures,
   federal screening flags, MSA acceptance.
   Quickbase formula fields then derive: Vetting Score (0–100),
   Disqualifier Flag, Recommendation, Status.
     → Compliance reviewer verifies the PR-side items and approves/rejects.
```

### Step by step

1. **Intake form (`app/apply`, `components/IntakeForm.js`).** A bilingual
   (Spanish/English) form in six sections: Company & Capacity, Point of Contact &
   Accounting, Compliance Uploads, Trade References, the MSA, and Binding
   Execution. Entity type (Sole Prop / Partnership / LLC / Corp) drives the
   signer rules — partnerships require all partners to sign.

2. **Anti-abuse gates.** Two layers, both "works-until-configured" (skipped if
   their keys are unset, so dev/preview still functions):
   - **Cloudflare Turnstile** — widget renders when
     `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set; the server verifies the token in
     `/api/otp/request` and `/api/submit` when `TURNSTILE_SECRET_KEY` is set.
   - **Email OTP (stateless)** — when `NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION=1`,
     the contact email must be verified with a 6-digit code before submit. No
     DB/KV: the server emails the code (via **Resend**, `lib/email.js`) and hands
     the browser an HMAC-signed token (`lib/otp.js`) bound to email + a 10-minute
     expiry, then re-verifies it at submit. Routes: `/api/otp/request`
     (Turnstile-gated, sends the code) and `/api/otp/verify`.

3. **Compliance uploads (`/api/blob/upload`).** The seven PDFs (SURI, CRIM,
   Patente/ASUME, COI, CFSE, DACO, Financial Statements) upload **directly from
   the browser to Vercel Blob** (client-direct upload, which bypasses the
   serverless body-size limit). The upload route allows `application/pdf` and
   `image/png` and pins the completion callback to the production URL. The submit
   payload then carries `documents: [{ key, url, filename }]`.

4. **MSA + signatures (Binding Execution).** The full MSA (`lib/msa.js`, official
   Spanish text, section-numbered 1–28) renders as a formatted legal document.
   The attestation + personal-guarantee checkboxes are **locked until the
   applicant scrolls the MSA to the end**. Each signer provides a printed legal
   name, title, **and a drawn signature** (`components/SignaturePad.js`, a
   canvas pad). On submit each signature PNG is uploaded to Blob and its URL is
   stored on the signer.

5. **Submit (`/api/submit`).** Re-validates all fields server-side, re-verifies
   Turnstile + OTP (so forged client state can't bypass them), strips the
   anti-abuse tokens, then **forwards the validated payload to the n8n webhook**
   (`N8N_WEBHOOK_URL`, header `x-webhook-secret`). If `N8N_WEBHOOK_URL` is unset
   it logs and accepts (dev); on a webhook failure it returns **502** so the
   applicant retries rather than silently dropping the submission.

6. **n8n orchestration** (`n8n/subcontractor-vetting.workflow.json`; editable
   sources in `n8n/src/`). The webhook runs the chain shown above:
   - **SAM.gov Exclusions** — federal debarment / exclusion check by company name.
   - **Trade.gov CSL** — the Consolidated Screening List, which covers **OFAC**
     sanctions plus Commerce (BIS) and State lists in one call (header
     `subscription-key`).
   - **Evaluate Screening** — converts both results into Quickbase scoring
     *inputs*. A name-match is a flag for a human to clear, not an auto-reject; a
     failed/incomplete check sets `Screening Incomplete` so the record is reviewed
     rather than passed silently.
   - **Build Quickbase Record** — fetches each staged Blob PDF, base64-encodes it,
     and attaches it to the corresponding Quickbase **File Attachment** field.
   - **Create Record / Shape Response** — success is keyed off
     `createdRecordIds`, *not* HTTP status (Quickbase returns 200 even when a row
     is rejected, e.g. a duplicate EIN).
   - **Delete Staging Blob** — after responding, calls back the app's
     secret-protected `/api/blob/delete` to remove the staged document blobs.
     (Signature blobs are kept — they are the signature of record.)

7. **Quickbase record + scoring.** The record lands in table `bv32ejcgp`.
   **Scoring stays in Quickbase**: n8n only populates the *input* fields; a
   Formula-Numeric field computes the **0–100 Vetting Score**, and formula fields
   derive the **Disqualifier Flag** and **Recommendation**. A compliance reviewer
   then verifies the Puerto-Rico-side items (insurance limits, verified
   references, entity standing, DACO complaints, lawsuits) and approves/rejects.

---

## Scoring (Quickbase side)

The federal screens (SAM, OFAC) are **pass/fail gates** — a hit sets the
Disqualifier Flag and overrides everything; they add **zero** points. The 0–100
score is computed by a Quickbase formula from business/capacity inputs
(can-meet-volume, line of credit, financials uploaded, bonding vs. threshold,
insurance, verified references, entity standing) minus penalties (DACO
complaints, material lawsuits). n8n fills the automated inputs; the manual
PR-compliance inputs default conservatively until a reviewer confirms them, so a
clean applicant starts around 60 and rises after review. The exact formula and
field-by-field source table live in **`n8n/README.md`**.

## Document storage (Quickbase File Attachment fields)

Compliance PDFs are stored as **native Quickbase File Attachment fields**
(FIDs **81–87**), so they are downloadable and access-controlled *inside*
Quickbase. (An earlier version used URL-type fields, which only kept the
filename text and produced dead links — replaced by real attachment fields.)
Drawn **signatures** are stored as Blob URLs inside the signers JSON
(FID 47) — unguessable but public; can be hardened to a private store or a
Quickbase file field later if desired.

## Environment variables

Set in Vercel project settings (app) and n8n credentials — never commit them.

| Variable | Where | Purpose |
|---|---|---|
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | app | forward submissions to n8n |
| `BLOB_READ_WRITE_TOKEN` | app | Vercel Blob (set when a Blob store is connected) |
| `BLOB_CLEANUP_SECRET` | app + n8n | guards `/api/blob/delete`; matches n8n's "Blob Cleanup Secret" credential |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | app | Cloudflare Turnstile |
| `NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION` | app | `1` to require email OTP |
| `RESEND_API_KEY`, `RESEND_FROM` | app | OTP email delivery |
| `OTP_SECRET` | app | stable HMAC secret for OTP tokens |
| `OTP_DEV_ECHO` | app | dev only — return the OTP code in the API response |
| `BLOB_CALLBACK_URL` | app | optional override for the Blob upload-completion callback |

n8n holds five **credentials** (not env vars): the Webhook header secret, the
SAM.gov key (Query Auth `api_key`), the Trade.gov CSL key (Header Auth
`subscription-key`), the Quickbase user token (Header Auth `Authorization:
QB-USER-TOKEN …`), and the Blob Cleanup secret. See `n8n/README.md`.

## Repository layout

| Path | What |
|---|---|
| `app/apply`, `components/IntakeForm.js` | the intake form |
| `components/SignaturePad.js` | drawn-signature canvas |
| `lib/msa.js` | the MSA legal text (Spanish, sections 1–28) |
| `lib/otp.js`, `lib/turnstile.js`, `lib/email.js` | anti-abuse helpers |
| `app/api/submit` | validation + forward to n8n |
| `app/api/blob/upload`, `app/api/blob/delete` | Blob staging + cleanup |
| `app/api/otp/request`, `app/api/otp/verify` | email OTP |
| `n8n/subcontractor-vetting.workflow.json` | importable n8n workflow |
| `n8n/src/` | editable Code-node sources (regenerate per `n8n/README.md`) |

## Status

The full pipeline — form → anti-abuse → upload → n8n → SAM + OFAC screening →
Quickbase record (with real document attachments) → blob cleanup — is **live and
verified end-to-end against production**. Remaining work is operational: defining
the reviewer process for the manual scoring inputs, rotating shared secrets, and
deciding whether to harden signature storage to private.
