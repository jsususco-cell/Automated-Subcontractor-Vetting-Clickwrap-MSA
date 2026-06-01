# n8n Orchestration — Screen & Record

This folder holds the **n8n workflow** that turns an intake submission into a
screened, scored, document-complete Quickbase record. It is **step 6** of the
end-to-end system (see the root `README.md` for the full picture).

- `subcontractor-vetting.workflow.json` — the importable workflow (assembled from
  `src/`; do not hand-edit).
- `src/` — the editable Code-node sources. Edit here, then regenerate the JSON
  (see [Regenerating](#regenerating-the-workflow-json)).

> **Status: LIVE & verified.** Provisioned at **https://n8n.byrdsonservices.com**,
> writing to Quickbase app `buskqh26r` / table `bv32ejcgp`. The full chain
> (auth → SAM → OFAC → build → Quickbase create → respond → blob cleanup) has been
> verified end-to-end against production, with real downloadable document
> attachments. The notes below document how it works and how to maintain it.

## What it does

```
Webhook (POST, header-auth: x-webhook-secret)
  → Config & Prepare         (non-secret config + Quickbase FID map)
  → SAM.gov Exclusions       (GET api.sam.gov .../v4/exclusions?exclusionName=)
  → Trade.gov CSL            (GET data.trade.gov .../v1/search?name=  — OFAC + BIS + State)
  → Evaluate Screening       (turns both results into Quickbase scoring INPUTS)
  → Build Quickbase Record   (fetches each Blob PDF, base64-attaches it)
  → Quickbase: Create Record (POST api.quickbase.com/v1/records)
  → Shape Response           (success = createdRecordIds, NOT HTTP status)
  → Respond to Webhook       (returns { ok, recordId, flagged, screening })
  → Split Documents → Delete Staging Blob   (cleans up the staged Vercel Blobs)
```

**The 0–100 score is computed by Quickbase**, not n8n. n8n only populates the
*input* fields the Quickbase Formula-Numeric score reads (see
[Scoring](#scoring-quickbase-side)).

## The input contract

The app's `/api/submit` POSTs the intake JSON as-is; the webhook reads it from
`$json.body`. Fields: `companyName, trade, entityType, ownerName, ein,
licenseNumber, dacoReg, streetAddress, city, state, zip, municipio,
yearsInBusiness, revenue, activeCrews, bondSingle, canMeetVolume,
hasLineOfCredit, bonded, contact*, accounting*, references[],
signers[{name,title,signature}], documents[{key,url,filename}], attestation,
personalGuarantee, executedAt`.

## Maintaining the LIVE workflow (read this first)

- **For small config changes** (e.g. an FID, `appBaseUrl`), edit the
  **Config & Prepare** node directly in the n8n UI and Save. Reload the canvas
  first so it reflects current server state.
- **⚠️ Do NOT re-import to patch the live instance.** The importable JSON carries
  placeholder credential references (`REPLACE_*`), so importing it **unlinks all
  five credentials** and may spawn a duplicate, inactive workflow. Re-import is
  for standing up a *fresh* instance only.
- **⚠️ Canvas "Save" can clobber code.** If Code-node changes were pushed via the
  n8n API while a browser canvas was open/stale, hitting Save writes the stale
  browser copy back. Open the workflow fresh before editing. (Editing
  **Credentials** is always safe.)

## Credentials (five)

| Node | Type | Field / header | Value |
|------|------|----------------|-------|
| **Webhook** | Header Auth | `x-webhook-secret` | shared secret, also `N8N_WEBHOOK_SECRET` in the app |
| **SAM.gov Exclusions** | Query Auth | `api_key` | SAM.gov API key (register at open.gsa.gov) — **live** |
| **Trade.gov CSL** | Header Auth | `subscription-key` | Trade.gov key (developer.trade.gov → Products → Data Services Platform APIs → Profile) — **live** |
| **Quickbase: Create Record** | Header Auth | `Authorization` | `QB-USER-TOKEN <token>` (literal prefix + your token) |
| **Delete Staging Blob** | Header Auth | `x-cleanup-secret` | shared secret, also `BLOB_CLEANUP_SECRET` in the app |

> Trade.gov CSL covers **OFAC** (Treasury sanctions / SDN) plus Commerce (BIS)
> and State lists in one call — you don't register with OFAC separately. The key
> is free and goes in the `subscription-key` **header**, not a query param.

## Config & Prepare node

Holds all non-secret config (secrets live in credentials). Current live values:

- `quickbaseRealmHost` → `byrdsonservices.quickbase.com`
- `quickbaseTableId` → `bv32ejcgp` (app `buskqh26r`)
- `appBaseUrl` → `https://automated-subcontractor-vetting-cli.vercel.app`
  (used for the blob-cleanup callback)
- `requiredBondThreshold` → `50000`
- `samUrl` → `https://api.sam.gov/entity-information/v4/exclusions`
- `cslUrl` → `https://data.trade.gov/consolidated_screening_list/v1/search`
- `fieldMap` → real Quickbase FIDs for every data field. **Formula fields are
  excluded** from the write map (Quickbase derives them): `41` Disqualifier Flag,
  `57` Vetting Score, `58` Recommendation.
- `fileFieldMap` → the seven **File Attachment** FIDs, keyed by the intake upload
  keys: `suri:81, crim:82, patenteAsume:83, coi:84, cfse:85, daco:86,
  financials:87`. (These replaced the original URL-type fields 50–56, which could
  only hold filename text and produced dead links.)

## Scoring (Quickbase side)

The federal screens (SAM, OFAC) are **pass/fail gates** — a hit sets the
Disqualifier Flag and overrides the score; they add no points. The 0–100 score is
a Quickbase **Formula-Numeric** field. n8n fills the *automated* inputs; the
*manual* PR-compliance inputs default conservatively so the score stays low until
a reviewer verifies them (PR govt portals can't be scraped — project policy).

| Quickbase input | Set by | How |
|-----------------|--------|-----|
| Can Meet Volume, Has Line of Credit, Bonded, Bond Single | n8n | from the form |
| Financials Uploaded, CFSE Current | n8n | derived from which PDFs were uploaded |
| SAM Exclusion Hit, OFAC Hit, Screening Incomplete | n8n | from the federal checks |
| MSA Digitally Signed | n8n | from the attestation checkbox |
| Meets Insurance Limits, Verified References, Entity Standing, DACO Complaints, Material Lawsuits | **manual** | reviewer verifies (default low) |
| Required Bond Threshold | Quickbase | constant (50000) |

The formula (Formula-Numeric field, from the project blueprint):

```
var Number capacity  = If([Can Meet Volume]=true, 25, 0);
var Number financial = If([Has Line of Credit]=true, 10, 0) + If([Financials Uploaded]=true, 10, 0);
var Number bonding   = If([Bonded]=true and [Bond Single] >= [Required Bond Threshold], 15,
                          If([Bonded]=true, 8, 0));
var Number insurance = If([CFSE Current]=true, 5, 0) + If([Meets Insurance Limits]=true, 5, 0);
var Number refs      = Min(15, [Verified References] * 5);
var Number standing  = If([Entity Standing]="Active", 15, 0);

var Number complaintsPenalty = Min(15, [DACO Complaints] * 5);
var Number litigationPenalty = Min(20, [Material Lawsuits] * 7);

Max(0,
  ($capacity + $financial + $bonding + $insurance + $refs + $standing)
  - $complaintsPenalty - $litigationPenalty
)
```

## Caveats / things to know

- **Name-match false positives.** SAM/CSL are searched by company name, so a hit
  sets the Disqualifier Flag for a human to clear — it is *not* an automatic
  permanent rejection. Tighten with EIN/UEI later if desired.
- **Failed check ≠ clear.** If a screening call errors or returns an unexpected
  shape, `Screening Incomplete` is set so the record is reviewed, not passed.
- **Quickbase 200 ≠ created.** Quickbase returns HTTP 200 even when a row is
  rejected (it reports `metadata.lineErrors`), so success keys off
  `createdRecordIds`. Example: a duplicate **EIN** (a unique field) is rejected
  with `ok:false`.
- **Documents are real attachments.** `Build Quickbase Record` fetches each public
  Blob PDF via `this.helpers.httpRequest` and base64-attaches it to the File
  Attachment field — Quickbase stores the bytes (downloadable from Quickbase).
  Base64 must be single-line; `Buffer.toString('base64')` already is.
- **Cleanup runs after the response.** The staged *document* blobs are deleted via
  the app's `/api/blob/delete` callback. Signature blobs are kept (they're the
  signature of record). A failed delete is low-harm.

## Regenerating the workflow JSON

If you edit anything in `src/`, rebuild the importable file (PowerShell, from the
repo root). This JSON-encodes each `src/*.js` body into the template safely and
normalizes line endings to `\n`:

```powershell
$root = "n8n"
function ReadU($p){ ([IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)).Replace("`r`n","`n") }
$tpl = ReadU "$root/src/workflow.template.json"
$map = [ordered]@{ '"@@CONFIG_JS@@"'='01-config.js'; '"@@EVALUATE_JS@@"'='02-evaluate.js';
  '"@@BUILD_JS@@"'='03-build.js'; '"@@SHAPE_JS@@"'='04-shape.js'; '"@@SPLIT_JS@@"'='05-split.js' }
foreach ($t in $map.Keys) { $tpl = $tpl.Replace($t, (ReadU "$root/src/$($map[$t])" | ConvertTo-Json)) }
$null = $tpl | ConvertFrom-Json   # validate
[IO.File]::WriteAllText("$root/subcontractor-vetting.workflow.json", $tpl, (New-Object Text.UTF8Encoding($false)))
```

Remember: regenerating the JSON updates the repo (source of truth), but the
**live** workflow only picks up Code-node changes if you re-import (resets
credentials) or paste the change into the node directly — see
[Maintaining](#maintaining-the-live-workflow-read-this-first).
