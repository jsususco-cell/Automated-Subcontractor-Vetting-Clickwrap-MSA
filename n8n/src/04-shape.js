// Summarises the result for the synchronous webhook response sent back to the
// Next.js /api/submit handler.
//
// IMPORTANT: Quickbase returns HTTP 200 even when a record is NOT created (it
// reports per-row problems in metadata.lineErrors). So success is determined by
// an actual created record id, not by the HTTP status.
const qb = $input.first().json || {};
const built = $('Build Quickbase Record').first().json;
const md = qb.metadata || {};
const recId =
  Array.isArray(md.createdRecordIds) && md.createdRecordIds.length
    ? md.createdRecordIds[0]
    : null;
const lineErrors = md.lineErrors || null;
const created = recId !== null;

return [
  {
    json: {
      ok: created,
      quickbaseRecordId: recId,
      quickbaseLineErrors: lineErrors,
      // A non-created record is always "flagged"; a created one is flagged when
      // screening hit something or could not be completed.
      flagged: created
        ? built.screening.disqualifierFlag || built.screening.screeningIncomplete
        : true,
      screening: built.screening,
      documents: built.documents,
    },
  },
];
