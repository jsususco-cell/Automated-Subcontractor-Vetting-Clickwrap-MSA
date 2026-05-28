import { NextResponse } from "next/server";

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

  // TODO Phase 2: accept Vercel Blob URLs for the uploaded compliance PDFs.
  // TODO Phase 3: forward this payload (plus blob URLs) to the n8n webhook,
  //   which runs SAM.gov + OFAC checks and creates the Quickbase record.
  // NOTE: ACH banking is intentionally not collected here (deferred post-approval).
  console.log("Intake submission received:", JSON.stringify(data));

  return NextResponse.json({ ok: true, message: "Application received." });
}
