// Reads the incoming webhook payload and holds all NON-SECRET configuration.
// Secrets (API keys, tokens) live in n8n credentials, never in this workflow.
const body = $json.body || $json;

const config = {
  // --- Quickbase --- (app buskqh26r)
  quickbaseRealmHost: 'byrdsonservices.quickbase.com',
  quickbaseTableId: 'bv32ejcgp',
  requiredBondThreshold: 50000,
  // --- App callback used for blob cleanup (DELETE /api/blob/delete) ---
  appBaseUrl: 'https://your-app.vercel.app',
  // --- Federal screening endpoints ---
  samUrl: 'https://api.sam.gov/entity-information/v4/exclusions',
  cslUrl: 'https://data.trade.gov/consolidated_screening_list/v1/search',
  // --- Quickbase field IDs (FIDs), mapped to the live table bv32ejcgp. ---
  fieldMap: {
    companyName: 6, trade: 7, entityType: 8, ownerName: 9, ein: 10,
    licenseNumber: 11, dacoReg: 12, streetAddress: 13, city: 14, state: 16,
    zip: 17, municipio: 15, yearsInBusiness: 18, revenue: 19, activeCrews: 20,
    bondSingle: 31, canMeetVolume: 27, hasLineOfCredit: 28, bonded: 30,
    contactName: 21, contactEmail: 22, contactPhone: 23,
    accountingName: 24, accountingEmail: 25, accountingPhone: 26,
    signers: 47, signerCount: 48, digitalSignatureName: 45, signerTitle: 46,
    personalGuarantee: 43, executedAt: 44, status: 59,
    // screening / scoring inputs. NOTE: "Disqualifier Flag" (41), "Vetting
    // Score" (57), and "Recommendation" (58) are Quickbase FORMULA fields — they
    // are derived by Quickbase and must NOT be written here.
    samExclusionHit: 39, ofacHit: 40,
    msaDigitallySigned: 42, financialsUploaded: 29, cfseCurrent: 33,
    meetsInsuranceLimits: 34, verifiedReferences: 35, entityStanding: 36,
    dacoComplaints: 37, materialLawsuits: 38, screeningIncomplete: 70,
  },
  // File-attachment FIDs, keyed by the upload key from the intake form.
  fileFieldMap: {
    suri: 50, crim: 51, patenteAsume: 52, coi: 53, cfse: 54, daco: 55,
    financials: 56,
  },
};

return [{ json: { body, config } }];
