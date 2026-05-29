import { createHmac, randomInt, timingSafeEqual } from "crypto";

// Stateless one-time-passcode (OTP) for email verification.
//
// No database/KV is required: the server emails a 6-digit code and hands the
// browser an opaque, HMAC-signed token that binds the email + expiry. To verify,
// the server recomputes the signature from the token header + the code the user
// typed. Only someone who received the emailed code (and the server, which holds
// OTP_SECRET) can produce a matching signature — the token alone reveals nothing
// that lets a client forge a verification.

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function secret() {
  // A stable secret is required so a token issued by one request can be verified
  // by another. Set OTP_SECRET in production; the dev fallback is insecure.
  return process.env.OTP_SECRET || "dev-insecure-otp-secret-change-me";
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sign(data) {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

// Returns { code, token, ttlSeconds }. Email `code`; hand `token` to the client.
export function createOtp(email) {
  const e = normEmail(email);
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const exp = Date.now() + TTL_MS;
  const header = Buffer.from(JSON.stringify({ e, exp })).toString("base64url");
  const sig = sign(`${header}.${code}`);
  return { code, token: `${header}.${sig}`, ttlSeconds: TTL_MS / 1000 };
}

// Returns { ok: boolean, reason?: string }.
export function verifyOtp(email, token, code) {
  const e = normEmail(email);
  const c = String(code || "").trim();
  if (!token || !/^\d{6}$/.test(c)) return { ok: false, reason: "invalid" };

  const parts = String(token).split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [header, sig] = parts;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.e !== e) return { ok: false, reason: "email_mismatch" };
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return { ok: false, reason: "expired" };
  }

  const expected = sign(`${header}.${c}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
