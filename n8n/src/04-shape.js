// Summarises the result for the synchronous webhook response sent back to the
// Next.js /api/submit handler.
const qb = $input.first().json || {};
const built = $('Build Quickbase Record').first().json;
const recId =
  qb.metadata && Array.isArray(qb.metadata.createdRecordIds)
    ? qb.metadata.createdRecordIds[0]
    : null;

return [
  {
    json: {
      ok: true,
      quickbaseRecordId: recId,
      flagged: built.screening.disqualifierFlag || built.screening.screeningIncomplete,
      screening: built.screening,
      documents: built.documents,
    },
  },
];
