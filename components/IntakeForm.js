"use client";

import { useState } from "react";
import { MSA_TITLE, MSA_PLACEHOLDER } from "@/lib/msa";

const EIN_PATTERN = /^\d{2}-\d{7}$/;

// Compliance documents the contractor must upload (PDF, <=10MB each).
// `key` maps to the corresponding Quickbase file-attachment field.
const UPLOADS = [
  { key: "suri", label: "SURI / Hacienda Certification" },
  { key: "crim", label: "CRIM Property Tax Certification" },
  { key: "patenteAsume", label: "Patente Municipal & ASUME Negativa" },
  { key: "coi", label: "Certificate of Insurance (COI)" },
  { key: "cfse", label: "CFSE Póliza Vigente (Workers' Comp)" },
  { key: "daco", label: "DACO Certificate (Registro de Contratistas)" },
  { key: "financials", label: "Financial Statements" },
];

export default function IntakeForm() {
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null); // { type: "ok"|"err", msg }
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function validate(form) {
    const e = {};
    const required = {
      companyName: "Legal Company Name",
      ownerName: "Owner Name",
      ein: "EIN",
      dacoReg: "DACO Registration Number",
      municipio: "Municipio",
      signatureName: "Digital Signature",
      title: "Title / Position",
    };
    for (const [name, label] of Object.entries(required)) {
      if (!String(form.get(name) || "").trim()) e[name] = `${label} is required.`;
    }
    const ein = String(form.get("ein") || "").trim();
    if (ein && !EIN_PATTERN.test(ein)) {
      e.ein = "EIN must use the format XX-XXXXXXX.";
    }
    if (form.get("attestation") !== "on") {
      e.attestation = "You must accept the MSA to submit.";
    }
    return e;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBanner(null);
    const form = new FormData(event.currentTarget);

    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setBanner({ type: "err", msg: "Please correct the highlighted fields." });
      return;
    }

    // Text payload only for now. File uploads are wired in Phase 2 (Vercel Blob
    // client-direct upload -> blob URLs passed here), then forwarded to n8n.
    const payload = {
      companyName: form.get("companyName"),
      ownerName: form.get("ownerName"),
      ein: form.get("ein"),
      dacoReg: form.get("dacoReg"),
      municipio: form.get("municipio"),
      yearsInBusiness: form.get("yearsInBusiness"),
      revenue: form.get("revenue"),
      activeCrews: form.get("activeCrews"),
      canMeetVolume: form.get("canMeetVolume") === "on",
      hasLineOfCredit: form.get("hasLineOfCredit") === "on",
      bonded: form.get("bonded") === "on",
      bondSingle: form.get("bondSingle"),
      references: [0, 1, 2].map((i) => ({
        name: form.get(`refName${i}`),
        company: form.get(`refCompany${i}`),
        phone: form.get(`refPhone${i}`),
        email: form.get(`refEmail${i}`),
      })),
      attestation: form.get("attestation") === "on",
      signatureName: form.get("signatureName"),
      title: form.get("title"),
      executedAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Submission failed.");
      }
      setDone(true);
      setBanner({ type: "ok", msg: "Application received. Thank you." });
    } catch (err) {
      setBanner({ type: "err", msg: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="section">
        <h1>Application Received</h1>
        <p className="lead">
          Thank you. Your application and MSA acceptance have been recorded. Our
          compliance team will review your submission and follow up.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="section">
        <h1>Subcontractor Application & MSA</h1>
        <p className="lead">
          Complete all sections. Fields marked <span className="req">*</span>{" "}
          are required.
        </p>
      </div>

      {banner && <div className={`banner ${banner.type}`}>{banner.msg}</div>}

      {/* Section 1 */}
      <section className="section">
        <h2>1. Company Information & Capacity</h2>
        <p className="hint">Tell us about your firm and its capacity.</p>

        <div className="field">
          <label>
            Legal Company Name <span className="req">*</span>
          </label>
          <input type="text" name="companyName" />
          {errors.companyName && <div className="error">{errors.companyName}</div>}
        </div>

        <div className="row">
          <div className="field">
            <label>
              Owner Name <span className="req">*</span>
            </label>
            <input type="text" name="ownerName" />
            {errors.ownerName && <div className="error">{errors.ownerName}</div>}
          </div>
          <div className="field">
            <label>
              EIN <span className="req">*</span>
            </label>
            <input type="text" name="ein" placeholder="XX-XXXXXXX" />
            {errors.ein && <div className="error">{errors.ein}</div>}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>
              DACO Contractor Registration Number <span className="req">*</span>
            </label>
            <input type="text" name="dacoReg" />
            {errors.dacoReg && <div className="error">{errors.dacoReg}</div>}
          </div>
          <div className="field">
            <label>
              Municipio <span className="req">*</span>
            </label>
            <input type="text" name="municipio" />
            {errors.municipio && <div className="error">{errors.municipio}</div>}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Years in Business</label>
            <input type="number" name="yearsInBusiness" min="0" />
          </div>
          <div className="field">
            <label>Annual Revenue (USD)</label>
            <input type="number" name="revenue" min="0" step="1000" />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Active Crews</label>
            <input type="number" name="activeCrews" min="0" />
          </div>
          <div className="field">
            <label>Single-Project Bond Capacity (USD)</label>
            <input type="number" name="bondSingle" min="0" step="1000" />
          </div>
        </div>

        <div className="check">
          <input type="checkbox" id="canMeetVolume" name="canMeetVolume" />
          <label htmlFor="canMeetVolume">
            Our firm can meet Byrdson&apos;s projected work volume.
          </label>
        </div>
        <div className="check">
          <input type="checkbox" id="hasLineOfCredit" name="hasLineOfCredit" />
          <label htmlFor="hasLineOfCredit">
            We have an established business line of credit.
          </label>
        </div>
        <div className="check">
          <input type="checkbox" id="bonded" name="bonded" />
          <label htmlFor="bonded">We are bonded.</label>
        </div>
      </section>

      {/* Section 2 */}
      <section className="section">
        <h2>2. Mandatory Compliance Uploads</h2>
        <p className="hint">PDF only, max 10MB each.</p>
        <p className="todo">
          Note: file uploads are not yet wired to storage (Phase 2 — Vercel Blob
          client-upload). Selecting files here does not yet transmit them.
        </p>
        {UPLOADS.map((u) => (
          <div className="field" key={u.key}>
            <label>{u.label}</label>
            <input type="file" name={`file_${u.key}`} accept="application/pdf" />
          </div>
        ))}
      </section>

      {/* Section 3 */}
      <section className="section">
        <h2>3. Trade References</h2>
        <p className="hint">
          Provide up to three references. Our compliance team verifies these
          after submission.
        </p>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div className="row">
              <div className="field">
                <label>Reference {i + 1} — Name</label>
                <input type="text" name={`refName${i}`} />
              </div>
              <div className="field">
                <label>Company</label>
                <input type="text" name={`refCompany${i}`} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Phone</label>
                <input type="tel" name={`refPhone${i}`} />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" name={`refEmail${i}`} />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Section 4 */}
      <section className="section">
        <h2>4. {MSA_TITLE}</h2>
        <p className="hint">
          Read the full agreement below. You must accept it to submit.
        </p>
        <div className="msa-box">{MSA_PLACEHOLDER}</div>
      </section>

      {/* Section 5 */}
      <section className="section">
        <h2>5. Binding Execution</h2>
        <div className="attest">
          <div className="check">
            <input type="checkbox" id="attestation" name="attestation" />
            <label htmlFor="attestation">
              BY CHECKING THIS BOX, I EXPRESSLY AGREE TO BE BOUND BY ALL THE
              TERMS, CONDITIONS, AND PROVISIONS OF THE MASTER SERVICES AGREEMENT
              DETAILED ABOVE. I CERTIFY THAT THE INFORMATION PROVIDED IN THIS
              FORM IS TRUE AND ACCURATE. <span className="req">*</span>
            </label>
          </div>
          {errors.attestation && (
            <div className="error">{errors.attestation}</div>
          )}
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <div className="field">
            <label>
              Digital Signature (Full Legal Name) <span className="req">*</span>
            </label>
            <input type="text" name="signatureName" />
            {errors.signatureName && (
              <div className="error">{errors.signatureName}</div>
            )}
          </div>
          <div className="field">
            <label>
              Title / Position <span className="req">*</span>
            </label>
            <input type="text" name="title" />
            {errors.title && <div className="error">{errors.title}</div>}
          </div>
        </div>
      </section>

      <div className="section">
        <button className="btn" type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Application"}
        </button>
      </div>
    </form>
  );
}
