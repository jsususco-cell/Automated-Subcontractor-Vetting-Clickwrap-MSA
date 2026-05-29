// Server-side Cloudflare Turnstile verification.
//
// Follows the same "works until configured" pattern as the rest of the app: if
// TURNSTILE_SECRET_KEY is unset, verification is skipped so the form still works
// in dev / before keys are provisioned. SET IT IN PRODUCTION to enforce.
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing-token" };

  try {
    const form = new URLSearchParams();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch(SITEVERIFY, { method: "POST", body: form });
    const data = await res.json();
    return { ok: !!data.success, data };
  } catch (error) {
    return { ok: false, reason: "verify-error" };
  }
}
