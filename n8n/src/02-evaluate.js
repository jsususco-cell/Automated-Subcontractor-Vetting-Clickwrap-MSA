// Combines the two federal screening results into the boolean/flag INPUTS that
// Quickbase's 0-100 scoring formula consumes. The score itself is computed by
// Quickbase (a Formula - Numeric field), NOT here — see n8n/README.md.
const prep = $('Config & Prepare').first().json;
const p = prep.body;
const cfg = prep.config;

// The HTTP nodes may hand us either a parsed object or, when the API returns
// JSON under a non-JSON content type, the raw body as a string under `.data`.
// Normalise both shapes.
function parseBody(x) {
  if (x == null) return {};
  if (typeof x === 'string') {
    try { return JSON.parse(x); } catch (e) { return {}; }
  }
  if (typeof x.data === 'string') {
    try { return JSON.parse(x.data); } catch (e) { return {}; }
  }
  return x;
}
const sam = parseBody($('SAM.gov Exclusions').first().json);
const csl = parseBody($('Trade.gov CSL').first().json);

// SAM exclusions API returns { totalRecords, excludedEntity: [...] }.
const samTotal = Number(
  sam.totalRecords != null
    ? sam.totalRecords
    : Array.isArray(sam.excludedEntity)
    ? sam.excludedEntity.length
    : NaN
);
// Trade.gov CSL search API returns { total, results: [...] }.
const cslTotal = Number(
  csl.total != null ? csl.total : Array.isArray(csl.results) ? csl.results.length : NaN
);

// If either response is missing its expected shape, the check failed. Flag for
// manual review rather than silently treating a failed check as "clear".
const screeningIncomplete = Number.isNaN(samTotal) || Number.isNaN(cslTotal);

const samExclusionHit = samTotal > 0;
const ofacHit = cslTotal > 0;
const docKeys = (p.documents || []).map((d) => d.key);

const screening = {
  samExclusionHit,
  ofacHit,
  samMatchCount: Number.isNaN(samTotal) ? null : samTotal,
  ofacMatchCount: Number.isNaN(cslTotal) ? null : cslTotal,
  // A name match can be a false positive; treat it as a hard flag for a human
  // to clear, not an automatic permanent rejection.
  disqualifierFlag: samExclusionHit || ofacHit,
  screeningIncomplete,
  msaDigitallySigned: p.attestation === true,
  financialsUploaded: docKeys.includes('financials'),
  cfseCurrent: docKeys.includes('cfse'),
  coiUploaded: docKeys.includes('coi'),
  referencesProvided: (p.references || []).filter((r) => r && r.name).length,
};

return [{ json: { payload: p, config: cfg, screening } }];
