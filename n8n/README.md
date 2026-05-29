# n8n Orchestration — Screen & Record

This folder holds the **importable n8n workflow** that turns an intake submission
into a screened, scored Quickbase record.

- `subcontractor-vetting.workflow.json` — **import this** into n8n.
- `src/` — the editable sources (the workflow JSON is assembled from these; see
  [Regenerating](#regenerating-the-workflow-json) at the bottom). Edit here, not
  in the big JSON, when you want to change a Code node.

> **Status:** drafted against the locked architecture, but **nothing is
> provisioned yet** (no n8n instance, Quickbase app, or API keys). Every secret
> is a credential placeholder and every Quickbase field ID is a dummy number you
> must replace. It will not run end-to-end until the setup below is done.

## What it does

```
Webhook (POST, header-auth)
  → Config & Prepare        (holds all non-secret config + Quickbase FID map)
  → SAM.gov Exclusions      (GET api.sam.gov .../v4/exclusions?exclusionName=)
  → Trade.gov CSL           (GET data.trade.gov .../v1/search?name=  — OFAC etc.)
  → Evaluate Screening      (turns both results into Quickbase scoring INPUTS)
  → Build Quickbase Record  (fetches each Blob PDF, base64-encodes, builds body)
  → Quickbase: Create Record(POST api.quickbase.com/v1/records)
  → Shape Response
  → Respond to Webhook      (returns { ok, recordId, flagged, screening })
  → Split Documents → Delete Staging Blob  (cleans up Vercel Blobs after the fact)
```

**Important design point:** the **0–100 score is computed by Quickbase**, not by
n8n. n8n only populates the *input* fields the Quickbase formula reads (see
[Scoring](#scoring-quickbase-side)). This matches the locked decision to keep
scoring as a Quickbase Formula-Numeric field.

## 1. Import

n8n → **Workflows → Import from File** → pick
`subcontractor-vetting.workflow.json`. You'll see "credential not set" warnings
on five nodes — that's expected; create them next.

## 2. Create the five credentials

| Node | Credential type | Field/header name | Value |
|------|-----------------|-------------------|-------|
| **Webhook** | Header Auth | `x-webhook-secret` | a random shared secret (also set as `N8N_WEBHOOK_SECRET` in the app) |
| **SAM.gov Exclusions** | Query Auth | `api_key` | your SAM.gov public API key |
| **Trade.gov CSL** | Header Auth | `subscription-key` | your Trade.gov Data Services key |
| **Quickbase: Create Record** | Header Auth | `Authorization` | `QB-USER-TOKEN xxxxxxxxx` (literally that prefix + your user token) |
| **Delete Staging Blob** | Header Auth | `x-cleanup-secret` | random secret (also set as `BLOB_CLEANUP_SECRET` in the app) |

Getting the keys: SAM.gov — register at https://open.gsa.gov/api/exclusions-api/.
CSL — subscribe at https://developer.trade.gov/ (the key is on your profile;
it goes in the `subscription-key` **header**, not a query param). Quickbase user
token — https://help.quickbase.com/ → User Token.

## 3. Edit the Config node

Open **Config & Prepare** and set the real values at the top:

- `quickbaseRealmHost` → e.g. `byrdson.quickbase.com`
- `quickbaseTableId` → the table DBID (the `bxxxxxxx` in the table URL)
- `appBaseUrl` → the deployed Vercel URL (used for blob cleanup callback)
- `requiredBondThreshold` → the bond threshold your scoring uses (default 50000)
- `fieldMap` → **replace every number** with the real Quickbase FID for that
  field (Quickbase → table → **Settings → Fields** lists each field's ID)
- `fileFieldMap` → the FIDs of the seven **File Attachment** fields, keyed by the
  intake form's upload keys (`suri`, `crim`, `patenteAsume`, `coi`, `cfse`,
  `daco`, `financials`)

## 4. Wire the app to the webhook (the remaining glue)

After **Save → Activate**, n8n shows the production webhook URL
(`https://<your-n8n>/webhook/subcontractor-vetting`). The app's `/api/submit`
must POST the submission to it. That forwarding is **not yet in the app** — it's
the small next step. The contract the workflow already expects:

```js
// in app/api/submit/route.js, after validation succeeds:
await fetch(process.env.N8N_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET, // matches the Webhook cred
  },
  body: JSON.stringify(data), // the exact payload IntakeForm builds
});
```

The webhook reads the submission from `$json.body`, so the payload is the intake
form's JSON as-is: `companyName, trade, entityType, ownerName, ein,
licenseNumber, dacoReg, streetAddress, city, state, zip, municipio,
yearsInBusiness, revenue, activeCrews, bondSingle, canMeetVolume,
hasLineOfCredit, bonded, contact*, accounting*, references[], signers[],
documents[{key,url,filename}], attestation, personalGuarantee, executedAt`.

### App env vars (Vercel project settings)

- `N8N_WEBHOOK_URL` — the production webhook URL
- `N8N_WEBHOOK_SECRET` — same value as the Webhook Header Auth credential
- `BLOB_CLEANUP_SECRET` — same value as the Blob Cleanup Header Auth credential
- `BLOB_READ_WRITE_TOKEN` — set automatically when you connect a Blob store

## Scoring (Quickbase side)

Create these fields in Quickbase, then add the official §3 formula as a
**Formula - Numeric** field. The workflow fills the *automated* inputs; the
*manual* inputs default conservatively so the initial score stays low until a
compliance reviewer verifies the PR-side items (PR govt portals can't be
scraped, by project policy).

| Quickbase input | Set by | How |
|-----------------|--------|-----|
| Can Meet Volume, Has Line of Credit, Bonded, Bond Single | n8n | from form |
| Financials Uploaded, CFSE Current | n8n | derived from which PDFs were uploaded |
| SAM Exclusion Hit, OFAC Hit, Disqualifier Flag, Screening Incomplete | n8n | from the federal checks |
| MSA Digitally Signed | n8n | from the attestation checkbox |
| Meets Insurance Limits | **manual** | reviewer verifies the COI |
| Verified References | **manual** | reviewer calls references |
| Entity Standing | **manual** | reviewer confirms (defaults `Pending Review`) |
| DACO Complaints, Material Lawsuits | **manual** | reviewer checks PR portals |
| Required Bond Threshold | Quickbase | a constant field / default |

The formula (from the project blueprint, paste verbatim):

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
  sets `Disqualifier Flag` for a human to clear — it is *not* an automatic
  permanent rejection. Tighten with EIN/UEI later if desired.
- **Failed check ≠ clear.** If either screening call errors, `Screening
  Incomplete` is set so the record is reviewed rather than passed silently.
- **Code node helpers.** `Build Quickbase Record` uses
  `this.helpers.httpRequest` to fetch the PDFs; this is available in current n8n.
  If your instance blocks it, swap to a Split-Out → HTTP (binary) → base64 chain.
- **Cleanup runs after the response.** Blobs are deleted *after* the webhook
  responds. If a delete fails the user still succeeds; orphaned staging blobs are
  low-harm and can be GC'd later.
- **Quickbase base64** must have no newlines — `Buffer.toString('base64')`
  already produces a single line, so that's handled.

## Regenerating the workflow JSON

If you edit anything in `src/`, rebuild the importable file (PowerShell, from the
repo root). This JSON-encodes each `src/*.js` body into the template safely:

```powershell
$dir = "n8n"
function ReadU($p){ [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }
$tpl = ReadU "$dir/src/workflow.template.json"
$map = [ordered]@{ '"@@CONFIG_JS@@"'='01-config.js'; '"@@EVALUATE_JS@@"'='02-evaluate.js';
  '"@@BUILD_JS@@"'='03-build.js'; '"@@SHAPE_JS@@"'='04-shape.js'; '"@@SPLIT_JS@@"'='05-split.js' }
foreach ($t in $map.Keys) { $tpl = $tpl.Replace($t, (ReadU "$dir/src/$($map[$t])" | ConvertTo-Json)) }
$null = $tpl | ConvertFrom-Json   # validate
[IO.File]::WriteAllText("$dir/subcontractor-vetting.workflow.json", $tpl, (New-Object Text.UTF8Encoding($false)))
```
