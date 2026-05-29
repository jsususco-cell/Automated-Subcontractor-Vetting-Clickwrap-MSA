import { NextResponse } from "next/server";
import { verifyOtp } from "@/lib/otp";

// Verifies a code against its token for inline UI feedback. The final /api/submit
// re-verifies, so a forged "verified" state on the client cannot bypass this.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const result = verifyOtp(body.email, body.token, body.code);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired code." },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
