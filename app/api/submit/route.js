import { NextResponse } from "next/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { verifyOtp } from "@/lib/otp";

const REQUIRE_EMAIL_VERIFICATION =
  process.env.NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION === "1";

const REQUIRED = [
  "companyName",
  "trade",
  "entityType",
  "ownerName",
  "ein",
  "licenseNumber",
  "dacoReg",
  "streetAddress",
  "municipio",
];

const EIN_PATTERN = /^\d{2}-\d{7}$/;

export async function POST(request) {
  let data;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const missing = REQUIRED.filter(
    (k) => !data[k] || String(data[k]).trim() === ""
  );
  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }
  if (!EIN_PATTERN.test(String(data.ein).trim())) {
    return NextResponse.json(
      { ok: false, error: "EIN must use the format XX-XXXXXXX." },
      { status: 400 }
    );
  }

  const signers = Array.isArray(data.signers) ? data.signers : [];
  const validSigners = signers.filter(
    (s) => s && String(s.name).trim() && String(s.title).trim()
  );
  if (validSigners.length === 0) {
    return NextResponse.json(
      { ok: false, error: "At least one signer (name + title) is required." },
      { status: 400 }
    );
  }
  // Partnerships require all partners to sign.
  if (data.entityType === "partnership" && validSigners.length < 2) {
    return NextResponse.json(
      { ok: false, error: "Partnerships require all partners to sign." },
      { status: 400 }
    );
  }

  if (data.attestation !== true) {
    return NextResponse.json(
      { ok: false, error: "MSA attestation is required." },
      { status: 400 }
    );
  }
  if (data.personalGuarantee !== true) {
    return NextResponse.json(
      { ok: false, error: "Personal guarantee acceptance is required." },
      { status: 400 }
    );
  }

  // Anti-abuse: Cloudflare Turnstile (skipped if TURNSTILE_SECRET_KEY unset).
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ts = await verifyTurnstile(data.turnstileToken, ip);
  if (!ts.ok) {
    return NextResponse.json(
      { ok: false, error: "CAPTCHA verification failed. Please try again." },
      { status: 400 }
    );
  }

  // Email verification: enforced only when turned on (so the form works before a
  // mail provider is configured). Re-verified here so a forged client state can't
  // bypass it; the OTP is bound to the contact email.
  if (REQUIRE_EMAIL_VERIFICATION) {
    const otp = verifyOtp(data.contactEmail, data.otpToken, data.otpCode);
    if (!otp.ok) {
      return NextResponse.json(
        { ok: false, error: "Please verify your contact email before submitting." },
        { status: 400 }
      );
    }
  }

  // Compliance PDFs arrive as Vercel Blob URLs: [{ key, url, filename }].
  const documents = Array.isArray(data.documents) ? data.documents : [];
  // NOTE: ACH banking is intentionally not collected here (deferred post-approval).

  // Strip anti-abuse fields — they are not part of the vetting record sent to n8n.
  const { turnstileToken, otpToken, otpCode, ...payload } = data;

  // Phase 3: forward the validated submission (incl. document blob URLs) to the
  // n8n webhook, which runs SAM.gov + OFAC checks, fetches each blob, attaches it
  // to the Quickbase file field, creates the record, then deletes the blobs.
  // See n8n/README.md for the contract.
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    // n8n isn't provisioned yet — log and accept so the form still works in dev.
    // Once N8N_WEBHOOK_URL is set, this branch no longer runs.
    console.log(
      "Intake submission received (n8n not configured):",
      JSON.stringify({ ...payload, documentCount: documents.length })
    );
    return NextResponse.json({ ok: true, message: "Application received." });
  }

  // n8n's "Respond to Webhook" node replies only after the Quickbase write, so
  // give it a generous timeout. (If latency becomes an issue, switch the n8n
  // workflow to respond immediately and process asynchronously.)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Matches the Webhook node's Header Auth credential in n8n.
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`n8n responded ${res.status}`);
    }
  } catch (error) {
    // The applicant already accepted the MSA and uploaded files, so surface the
    // failure and let them retry rather than silently dropping the submission.
    console.error("Failed to forward submission to n8n:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          "We received your information but could not complete processing. Please try again in a moment.",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  return NextResponse.json({ ok: true, message: "Application received." });
}
