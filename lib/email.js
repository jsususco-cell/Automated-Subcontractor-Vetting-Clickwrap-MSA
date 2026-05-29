// Transactional email via Resend (https://resend.com).
//
// Set RESEND_API_KEY and (recommended) RESEND_FROM in the environment. RESEND_FROM
// must be an address on a domain verified in Resend, e.g.
//   "Byrdson Services <no-reply@byrdsonservices.com>"
// Until RESEND_API_KEY is set, sending is skipped and the code is logged so the
// flow is testable in dev.
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export async function sendOtpEmail(to, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Byrdson Services <onboarding@resend.dev>";

  if (!apiKey) {
    console.warn(`[otp] RESEND_API_KEY not set — code for ${to} is ${code} (dev only)`);
    return { ok: true, skipped: true };
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Su código de verificación / Your verification code — Byrdson",
      text: `Su código de verificación es ${code}. Expira en 10 minutos.\n\nYour verification code is ${code}. It expires in 10 minutes.`,
      html:
        `<p>Su código de verificación es <strong style="font-size:22px;letter-spacing:2px">${code}</strong>.<br>Expira en 10 minutos.</p>` +
        `<hr><p>Your verification code is <strong style="font-size:22px;letter-spacing:2px">${code}</strong>.<br>It expires in 10 minutes.</p>`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
  return { ok: true };
}
