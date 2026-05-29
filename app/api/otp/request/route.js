import { NextResponse } from "next/server";
import { createOtp } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";
import { verifyTurnstile } from "@/lib/turnstile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Issues an OTP: validates the email, checks Turnstile (the email-sending action
// is the main abuse vector / email-bomb risk), emails the code, and returns the
// signed token the browser later submits alongside the typed code.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const email = String(body.email || "").trim();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ts = await verifyTurnstile(body.turnstileToken, ip);
  if (!ts.ok) {
    return NextResponse.json({ ok: false, error: "CAPTCHA verification failed. Please try again." }, { status: 400 });
  }

  const { code, token, ttlSeconds } = createOtp(email);
  try {
    await sendOtpEmail(email, code);
  } catch (error) {
    console.error("OTP email failed:", error);
    return NextResponse.json({ ok: false, error: "Could not send the code. Please try again." }, { status: 502 });
  }

  const resp = { ok: true, token, ttlSeconds };
  // Dev-only: echo the code in the response so the flow can be tested before a
  // mail provider is configured. NEVER enable OTP_DEV_ECHO in production.
  if (process.env.OTP_DEV_ECHO === "1") resp.devCode = code;
  return NextResponse.json(resp);
}
