// Fans the staged documents out to one item each so the next node can DELETE
// each Vercel Blob. Emits nothing when there were no uploads (cleanup skipped).
return ($json.documents || []).map((d) => ({ json: d }));
