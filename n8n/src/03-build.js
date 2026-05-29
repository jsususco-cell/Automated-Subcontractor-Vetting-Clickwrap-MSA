// Builds the Quickbase "create record" body. Fetches each compliance PDF from
// its Vercel Blob URL and base64-encodes it for the file-attachment field.
// Requires an n8n whose Code node exposes this.helpers.httpRequest (v1.x+).
const ev = $('Evaluate Screening').first().json;
const p = ev.payload;
const s = ev.screening;
const cfg = ev.config;
const F = cfg.fieldMap;
const FF = cfg.fileFieldMap;

const rec = {};
const set = (fid, value) => {
  if (fid != null && value !== undefined) rec[fid] = { value };
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// --- Vendor / capacity fields ---
// Quickbase "Entity Type" is a restricted choice field; translate the form's
// short codes to its exact option labels.
const ENTITY_LABELS = {
  sole: 'Sole Proprietor',
  partnership: 'Partnership',
  llc: 'LLC',
  corp: 'Corporation',
};

set(F.companyName, p.companyName);
set(F.trade, p.trade);
set(F.entityType, ENTITY_LABELS[p.entityType] || p.entityType);
set(F.ownerName, p.ownerName);
set(F.ein, p.ein);
set(F.licenseNumber, p.licenseNumber);
set(F.dacoReg, p.dacoReg);
set(F.streetAddress, p.streetAddress);
set(F.city, p.city);
set(F.state, p.state);
set(F.zip, p.zip);
set(F.municipio, p.municipio);
set(F.yearsInBusiness, num(p.yearsInBusiness));
set(F.revenue, num(p.revenue));
set(F.activeCrews, num(p.activeCrews));
set(F.bondSingle, num(p.bondSingle));
set(F.canMeetVolume, !!p.canMeetVolume);
set(F.hasLineOfCredit, !!p.hasLineOfCredit);
set(F.bonded, !!p.bonded);

// --- Contacts ---
set(F.contactName, p.contactName);
set(F.contactEmail, p.contactEmail);
set(F.contactPhone, p.contactPhone);
set(F.accountingName, p.accountingName);
set(F.accountingEmail, p.accountingEmail);
set(F.accountingPhone, p.accountingPhone);

// --- Signers: full set as JSON text, plus flattened first-signer fields ---
const signers = Array.isArray(p.signers) ? p.signers : [];
set(F.signers, JSON.stringify(signers));
set(F.signerCount, signers.length);
set(F.digitalSignatureName, signers[0] && signers[0].name);
set(F.signerTitle, signers[0] && signers[0].title);
set(F.personalGuarantee, p.personalGuarantee === true);
set(F.executedAt, p.executedAt);
// Initial workflow status (restricted choice field).
set(F.status, s.disqualifierFlag || s.screeningIncomplete ? 'Under Review' : 'Pending');

// --- Screening / scoring inputs (federal, automated) ---
set(F.samExclusionHit, s.samExclusionHit);
set(F.ofacHit, s.ofacHit);
// Disqualifier Flag is a Quickbase formula field (derived from the hits above).
set(F.screeningIncomplete, s.screeningIncomplete);
set(F.msaDigitallySigned, s.msaDigitallySigned);
set(F.financialsUploaded, s.financialsUploaded);
set(F.cfseCurrent, s.cfseCurrent);

// --- Scoring inputs that require MANUAL PR-compliance review. Defaulted
//     conservatively so the initial Quickbase score stays low until a reviewer
//     verifies them (PR govt portals can't be scraped — see project notes). ---
set(F.meetsInsuranceLimits, false);
set(F.verifiedReferences, 0);
set(F.entityStanding, 'Pending Review');
set(F.dacoComplaints, 0);
set(F.materialLawsuits, 0);

// --- Fetch + attach compliance PDFs from their Vercel Blob URLs ---
for (const d of p.documents || []) {
  const fid = FF[d.key];
  if (!fid || !d.url) continue;
  const buf = await this.helpers.httpRequest({ url: d.url, encoding: 'arraybuffer' });
  const data = Buffer.from(buf).toString('base64');
  rec[fid] = { value: { fileName: d.filename || d.key + '.pdf', data } };
}

return [
  {
    json: {
      qbBody: { to: cfg.quickbaseTableId, data: [rec] },
      documents: p.documents || [],
      screening: s,
    },
  },
];
