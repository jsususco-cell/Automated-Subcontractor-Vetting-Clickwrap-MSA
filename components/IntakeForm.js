"use client";

import { useState, useEffect, useRef } from "react";
import { upload } from "@vercel/blob/client";
import { MSA_TITLE, MSA_TEXT_ES } from "@/lib/msa";
import SignaturePad from "@/components/SignaturePad";

const EIN_PATTERN = /^\d{2}-\d{7}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Anti-abuse feature flags (public env). Turnstile renders when a site key is
// present; email verification is required when explicitly turned on.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const REQUIRE_EMAIL_VERIFICATION =
  process.env.NEXT_PUBLIC_REQUIRE_EMAIL_VERIFICATION === "1";

// Compliance documents the contractor must upload (PDF, <=10MB each).
// `key` maps to the corresponding Quickbase file-attachment field.
const UPLOADS = [
  { key: "suri", es: "Certificación SURI / Hacienda", en: "SURI / Hacienda Certification" },
  { key: "crim", es: "Certificación CRIM (Contribución sobre la Propiedad)", en: "CRIM Property Tax Certification" },
  { key: "patenteAsume", es: "Patente Municipal y Negativa ASUME", en: "Patente Municipal & ASUME Negativa" },
  { key: "coi", es: "Certificado de Seguro (COI)", en: "Certificate of Insurance (COI)" },
  { key: "cfse", es: "Póliza CFSE Vigente (Comp. Obrera)", en: "CFSE Póliza Vigente (Workers' Comp)" },
  { key: "daco", es: "Certificado DACO (Registro de Contratistas)", en: "DACO Certificate (Registro de Contratistas)" },
  { key: "financials", es: "Estados Financieros", en: "Financial Statements" },
];

const ENTITY_TYPES = [
  { value: "sole", es: "Propietario único", en: "Sole Proprietor" },
  { value: "partnership", es: "Sociedad", en: "Partnership" },
  { value: "llc", es: "LLC", en: "LLC" },
  { value: "corp", es: "Corporación", en: "Corporation" },
];

// Bolds an ALL-CAPS clause/paragraph label that precedes a colon
// (e.g. "DESEMPEÑO OPORTUNO: ..."). Leaves other text untouched.
const MSA_LABEL_RE = /^([A-ZÁÉÍÓÚÑ][^a-z:]{2,70}):\s+([\s\S]+)$/;

function renderMsaInline(text) {
  const m = text.match(MSA_LABEL_RE);
  if (!m) return text;
  return (
    <>
      <span className="msa-label">{m[1]}:</span> {m[2]}
    </>
  );
}

// Renders the verbatim MSA text as a formatted legal document: a centered
// title, numbered section headings, hanging-indent lettered clauses (a., b.,
// …), and justified body paragraphs. The wording itself is never modified.
function MsaContent({ text }) {
  const out = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line === "CONTRATO MAESTRO DE SERVICIO") {
      out.push(
        <h3 key={i} className="msa-doc-title">
          {line}
        </h3>
      );
      return;
    }
    const section = line.match(/^(\d+)\.\s+(.+)$/);
    if (section) {
      out.push(
        <h4 key={i} className="msa-section">
          <span className="msa-num">{section[1]}.</span>
          {section[2]}
        </h4>
      );
      return;
    }
    const clause = line.match(/^([a-z])\.\s+(.+)$/);
    if (clause) {
      out.push(
        <p key={i} className="msa-clause">
          <span className="msa-letter">{clause[1]}.</span>
          {renderMsaInline(clause[2])}
        </p>
      );
      return;
    }
    out.push(
      <p key={i} className="msa-para">
        {renderMsaInline(line)}
      </p>
    );
  });
  return out;
}

// Converts a PNG data URL (from the signature pad) into a File for upload.
function dataUrlToFile(dataUrl, filename) {
  const [head, body] = dataUrl.split(",");
  const mime = (head.match(/data:(.*?);/) || [])[1] || "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

export default function IntakeForm() {
  const [lang, setLang] = useState("es");
  const [entityType, setEntityType] = useState("");
  const [signers, setSigners] = useState([
    { id: 1, name: "", title: "", signature: "" },
  ]);
  const nextSignerId = useRef(2);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [done, setDone] = useState(false);

  // The full MSA must be scrolled to the end before the binding-execution
  // checkboxes can be enabled/checked.
  const msaRef = useRef(null);
  const [msaRead, setMsaRead] = useState(false);

  // Contact email is controlled so email verification can track it.
  const [contactEmail, setContactEmail] = useState("");

  // Cloudflare Turnstile
  const tsRef = useRef(null);
  const tsWidgetId = useRef(null);
  const [tsToken, setTsToken] = useState("");
  const tsEnabled = Boolean(TURNSTILE_SITE_KEY);

  // Email OTP verification
  const [otpToken, setOtpToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState(null); // { type: "ok"|"err", text }

  // Bilingual helper: returns the string for the active language.
  const L = (es, en) => (lang === "es" ? es : en);

  // Load + render the Turnstile widget once (managed mode auto-solves).
  useEffect(() => {
    if (!tsEnabled) return undefined;
    const SCRIPT_ID = "cf-turnstile-script";
    function render() {
      if (!window.turnstile || !tsRef.current || tsWidgetId.current !== null) return;
      tsWidgetId.current = window.turnstile.render(tsRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t) => setTsToken(t),
        "expired-callback": () => setTsToken(""),
        "error-callback": () => setTsToken(""),
      });
    }
    if (window.turnstile) {
      render();
      return undefined;
    }
    let script = document.getElementById(SCRIPT_ID);
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const iv = setInterval(() => {
      if (window.turnstile) {
        clearInterval(iv);
        render();
      }
    }, 200);
    return () => clearInterval(iv);
  }, [tsEnabled]);

  // If the agreement is short enough to fit without scrolling, there's nothing
  // to scroll — treat it as read once mounted. Otherwise it's marked read when
  // the user scrolls to the bottom (see onMsaScroll).
  useEffect(() => {
    const el = msaRef.current;
    if (el && el.scrollHeight - el.clientHeight <= 8) setMsaRead(true);
  }, []);

  function onMsaScroll() {
    const el = msaRef.current;
    if (!el || msaRead) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setMsaRead(true);
  }

  // Returns the current Turnstile token (empty when not enabled — the server
  // skips verification in that case).
  function currentTurnstileToken() {
    if (!tsEnabled) return "";
    if (window.turnstile && tsWidgetId.current !== null) {
      return window.turnstile.getResponse(tsWidgetId.current) || "";
    }
    return tsToken || "";
  }
  // Force a fresh token for the next protected action (tokens are single-use).
  function resetTurnstile() {
    if (tsEnabled && window.turnstile && tsWidgetId.current !== null) {
      window.turnstile.reset(tsWidgetId.current);
      setTsToken("");
    }
  }

  function onContactEmailChange(value) {
    setContactEmail(value);
    // Changing the email invalidates a prior verification.
    if (emailVerified && value.trim() !== verifiedEmail) {
      setEmailVerified(false);
      setOtpSent(false);
      setOtpToken("");
      setOtpCode("");
      setOtpMsg(null);
    }
  }

  async function sendOtp() {
    setOtpMsg(null);
    const email = contactEmail.trim();
    if (!EMAIL_PATTERN.test(email)) {
      setOtpMsg({ type: "err", text: L("Ingrese un correo válido primero.", "Enter a valid email first.") });
      return;
    }
    const token = currentTurnstileToken();
    if (tsEnabled && !token) {
      setOtpMsg({ type: "err", text: L("Complete el CAPTCHA primero.", "Complete the CAPTCHA first.") });
      return;
    }
    setOtpBusy(true);
    try {
      const res = await fetch("/api/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: token }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || L("No se pudo enviar el código.", "Could not send the code."));
      }
      setOtpToken(data.token);
      setOtpSent(true);
      setEmailVerified(false);
      setOtpMsg({
        type: "ok",
        text: data.devCode
          ? L(`Código (dev): ${data.devCode}`, `Code (dev): ${data.devCode}`)
          : L("Código enviado a su correo.", "Code sent to your email."),
      });
      resetTurnstile(); // refresh token for the final submit
    } catch (err) {
      setOtpMsg({ type: "err", text: err.message });
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyOtpCode() {
    setOtpMsg(null);
    setOtpBusy(true);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: contactEmail.trim(), token: otpToken, code: otpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || L("Código inválido o expirado.", "Invalid or expired code."));
      }
      setEmailVerified(true);
      setVerifiedEmail(contactEmail.trim());
      setOtpMsg({ type: "ok", text: L("Correo verificado ✓", "Email verified ✓") });
    } catch (err) {
      setEmailVerified(false);
      setOtpMsg({ type: "err", text: err.message });
    } finally {
      setOtpBusy(false);
    }
  }

  function onEntityChange(value) {
    setEntityType(value);
    // Only partnerships need multiple signers; collapse to one otherwise.
    if (value !== "partnership") setSigners((prev) => prev.slice(0, 1));
  }

  function updateSigner(i, field, value) {
    setSigners((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s))
    );
  }
  function addSigner() {
    setSigners((prev) => [
      ...prev,
      { id: nextSignerId.current++, name: "", title: "", signature: "" },
    ]);
  }
  function removeSigner(i) {
    setSigners((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function signerInstruction() {
    switch (entityType) {
      case "sole":
        return L("El propietario debe firmar.", "The owner must sign.");
      case "partnership":
        return L("TODOS los socios deben firmar.", "ALL partners must sign.");
      case "corp":
        return L(
          "Debe firmar un funcionario legalmente autorizado.",
          "A legally authorized officer must sign."
        );
      case "llc":
        return L(
          "Debe firmar un gerente o miembro autorizado.",
          "An authorized manager or member must sign."
        );
      default:
        return L(
          "Seleccione el tipo de empresa arriba.",
          "Select the business type above."
        );
    }
  }

  function validate(form) {
    const e = {};
    const required = {
      companyName: L("Nombre legal de la empresa", "Legal Company Name"),
      trade: L("Comercio / Especialidad", "Trade"),
      ownerName: L("Nombre del propietario", "Owner Name"),
      ein: "EIN",
      licenseNumber: L("Número de licencia de contratista", "Contractor License Number"),
      dacoReg: L("Número de registro DACO", "DACO Registration Number"),
      streetAddress: L("Dirección", "Street Address"),
      municipio: L("Municipio", "Municipio"),
    };
    for (const [name, label] of Object.entries(required)) {
      if (!String(form.get(name) || "").trim()) {
        e[name] = L(`${label} es obligatorio.`, `${label} is required.`);
      }
    }
    const ein = String(form.get("ein") || "").trim();
    if (ein && !EIN_PATTERN.test(ein)) {
      e.ein = L("El EIN debe tener el formato XX-XXXXXXX.", "EIN must use the format XX-XXXXXXX.");
    }
    if (!entityType) {
      e.entityType = L("Seleccione el tipo de empresa.", "Select the business type.");
    }
    signers.forEach((s, i) => {
      if (!s.name.trim() || !s.title.trim()) {
        e[`signer${i}`] = L(
          "Nombre legal y título son obligatorios.",
          "Full legal name and title are required."
        );
      } else if (!s.signature) {
        e[`signer${i}`] = L(
          "Debe firmar en el recuadro.",
          "Please sign in the box."
        );
      }
    });
    if (form.get("attestation") !== "on") {
      e.attestation = L("Debe aceptar el MSA para enviar.", "You must accept the MSA to submit.");
    }
    if (form.get("personalGuarantee") !== "on") {
      e.personalGuarantee = L(
        "Debe aceptar la garantía personal.",
        "You must accept the personal guarantee."
      );
    }
    return e;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBanner(null);
    setUploadStatus("");
    const form = new FormData(event.currentTarget);

    const e = validate(form);

    // Collect and validate selected files (PDF, <=10MB).
    const selected = [];
    for (const u of UPLOADS) {
      const file = form.get(`file_${u.key}`);
      if (file && typeof file === "object" && file.size > 0) {
        if (file.type !== "application/pdf") {
          e[`file_${u.key}`] = L("Debe ser un PDF.", "Must be a PDF.");
        } else if (file.size > MAX_FILE_SIZE) {
          e[`file_${u.key}`] = L("Tamaño máximo 10MB.", "Max size 10MB.");
        } else {
          selected.push({ key: u.key, file });
        }
      }
    }

    setErrors(e);
    if (Object.keys(e).length > 0) {
      setBanner({
        type: "err",
        msg: L("Corrija los campos resaltados.", "Please correct the highlighted fields."),
      });
      return;
    }

    // Anti-abuse gates.
    if (
      REQUIRE_EMAIL_VERIFICATION &&
      (!emailVerified || verifiedEmail !== contactEmail.trim())
    ) {
      setBanner({
        type: "err",
        msg: L(
          "Verifique su correo de contacto antes de enviar.",
          "Please verify your contact email before submitting."
        ),
      });
      return;
    }
    const turnstileToken = currentTurnstileToken();
    if (tsEnabled && !turnstileToken) {
      setBanner({
        type: "err",
        msg: L(
          "Complete la verificación de seguridad (CAPTCHA).",
          "Please complete the security check (CAPTCHA)."
        ),
      });
      return;
    }

    setSubmitting(true);
    try {
      // Upload each PDF directly from the browser to Vercel Blob, which avoids
      // the serverless request-body size limit. We pass the resulting URLs to
      // the submit endpoint; Phase 3's n8n flow fetches them and attaches them
      // to Quickbase, then deletes the temporary blobs.
      const documents = [];
      for (let i = 0; i < selected.length; i++) {
        const { key, file } = selected[i];
        setUploadStatus(
          L(
            `Subiendo archivo ${i + 1} de ${selected.length}…`,
            `Uploading file ${i + 1} of ${selected.length}…`
          )
        );
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          clientPayload: JSON.stringify({ key }),
        });
        documents.push({ key, url: blob.url, filename: file.name });
      }

      // Upload each drawn signature (PNG data URL) to Blob; keep the URL on the
      // signer. The printed name + signature URL travel together in the signers
      // JSON written to Quickbase — no schema change needed.
      const signersWithUrls = [];
      for (let i = 0; i < signers.length; i++) {
        const s = signers[i];
        let signatureUrl = s.signature;
        if (typeof s.signature === "string" && s.signature.startsWith("data:")) {
          setUploadStatus(
            L(
              `Subiendo firma ${i + 1} de ${signers.length}…`,
              `Uploading signature ${i + 1} of ${signers.length}…`
            )
          );
          const file = dataUrlToFile(s.signature, `signature-${i + 1}.png`);
          const sigBlob = await upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/blob/upload",
            clientPayload: JSON.stringify({ kind: "signature" }),
          });
          signatureUrl = sigBlob.url;
        }
        signersWithUrls.push({
          name: s.name,
          title: s.title,
          signature: signatureUrl,
        });
      }
      setUploadStatus("");

      // ACH banking is intentionally NOT collected here (deferred to post-approval).
      const payload = {
        companyName: form.get("companyName"),
        trade: form.get("trade"),
        entityType,
        ownerName: form.get("ownerName"),
        ein: form.get("ein"),
        licenseNumber: form.get("licenseNumber"),
        dacoReg: form.get("dacoReg"),
        streetAddress: form.get("streetAddress"),
        city: form.get("city"),
        state: form.get("state"),
        zip: form.get("zip"),
        municipio: form.get("municipio"),
        yearsInBusiness: form.get("yearsInBusiness"),
        revenue: form.get("revenue"),
        activeCrews: form.get("activeCrews"),
        bondSingle: form.get("bondSingle"),
        canMeetVolume: form.get("canMeetVolume") === "on",
        hasLineOfCredit: form.get("hasLineOfCredit") === "on",
        bonded: form.get("bonded") === "on",
        contactName: form.get("contactName"),
        contactEmail: form.get("contactEmail"),
        contactPhone: form.get("contactPhone"),
        accountingName: form.get("accountingName"),
        accountingEmail: form.get("accountingEmail"),
        accountingPhone: form.get("accountingPhone"),
        references: [0, 1, 2].map((i) => ({
          name: form.get(`refName${i}`),
          company: form.get(`refCompany${i}`),
          phone: form.get(`refPhone${i}`),
          email: form.get(`refEmail${i}`),
        })),
        documents,
        signers: signersWithUrls,
        attestation: form.get("attestation") === "on",
        personalGuarantee: form.get("personalGuarantee") === "on",
        executedAt: new Date().toISOString(),
        // Anti-abuse tokens (stripped server-side, not stored in the record).
        turnstileToken,
        otpToken,
        otpCode,
      };

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || L("Error al enviar.", "Submission failed."));
      }
      setDone(true);
    } catch (err) {
      setBanner({ type: "err", msg: err.message });
    } finally {
      setSubmitting(false);
      setUploadStatus("");
      // Turnstile tokens are single-use; refresh for a potential retry.
      resetTurnstile();
    }
  }

  if (done) {
    return (
      <div className="section">
        <h1>{L("Solicitud Recibida", "Application Received")}</h1>
        <p className="lead">
          {L(
            "Gracias. Su solicitud y aceptación del MSA han sido registradas. Nuestro equipo de cumplimiento revisará su envío y se comunicará con usted.",
            "Thank you. Your application and MSA acceptance have been recorded. Our compliance team will review your submission and follow up."
          )}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="section">
        <div className="lang-toggle">
          <button
            type="button"
            className={lang === "es" ? "active" : ""}
            onClick={() => setLang("es")}
          >
            Español
          </button>
          <button
            type="button"
            className={lang === "en" ? "active" : ""}
            onClick={() => setLang("en")}
          >
            English
          </button>
        </div>
        <h1>
          {L(
            "Solicitud de Subcontratista y MSA",
            "Subcontractor Application & MSA"
          )}
        </h1>
        <p className="lead">
          {L(
            "Complete todas las secciones. Los campos marcados con ",
            "Complete all sections. Fields marked "
          )}
          <span className="req">*</span>
          {L(" son obligatorios.", " are required.")}
        </p>
      </div>

      {banner && <div className={`banner ${banner.type}`}>{banner.msg}</div>}

      {/* Section 1 */}
      <section className="section">
        <h2>
          1. {L("Información de la Empresa y Capacidad", "Company Information & Capacity")}
        </h2>

        <div className="field">
          <label>
            {L("Nombre legal de la empresa", "Legal Company Name")} <span className="req">*</span>
          </label>
          <input type="text" name="companyName" />
          {errors.companyName && <div className="error">{errors.companyName}</div>}
        </div>

        <div className="row">
          <div className="field">
            <label>
              {L("Comercio / Especialidad", "Trade")} <span className="req">*</span>
            </label>
            <input type="text" name="trade" />
            {errors.trade && <div className="error">{errors.trade}</div>}
          </div>
          <div className="field">
            <label>
              {L("Nombre del propietario", "Owner Name")} <span className="req">*</span>
            </label>
            <input type="text" name="ownerName" />
            {errors.ownerName && <div className="error">{errors.ownerName}</div>}
          </div>
        </div>

        <div className="field">
          <label>
            {L("Tipo de empresa", "Business Type")} <span className="req">*</span>
          </label>
          <div className="radio-group">
            {ENTITY_TYPES.map((t) => (
              <label key={t.value} className="radio">
                <input
                  type="radio"
                  name="entityType"
                  value={t.value}
                  checked={entityType === t.value}
                  onChange={(ev) => onEntityChange(ev.target.value)}
                />
                {L(t.es, t.en)}
              </label>
            ))}
          </div>
          {errors.entityType && <div className="error">{errors.entityType}</div>}
        </div>

        <div className="row">
          <div className="field">
            <label>
              EIN <span className="req">*</span>
            </label>
            <input type="text" name="ein" placeholder="XX-XXXXXXX" />
            {errors.ein && <div className="error">{errors.ein}</div>}
          </div>
          <div className="field">
            <label>
              {L("Número de licencia de contratista", "Contractor License Number")}{" "}
              <span className="req">*</span>
            </label>
            <input type="text" name="licenseNumber" />
            {errors.licenseNumber && <div className="error">{errors.licenseNumber}</div>}
          </div>
        </div>

        <div className="field">
          <label>
            {L("Número de registro DACO", "DACO Registration Number")}{" "}
            <span className="req">*</span>
          </label>
          <input type="text" name="dacoReg" />
          {errors.dacoReg && <div className="error">{errors.dacoReg}</div>}
        </div>

        <div className="field">
          <label>
            {L("Dirección", "Street Address")} <span className="req">*</span>
          </label>
          <input type="text" name="streetAddress" />
          {errors.streetAddress && <div className="error">{errors.streetAddress}</div>}
        </div>

        <div className="row">
          <div className="field">
            <label>{L("Ciudad", "City")}</label>
            <input type="text" name="city" />
          </div>
          <div className="field">
            <label>
              {L("Municipio", "Municipio")} <span className="req">*</span>
            </label>
            <input type="text" name="municipio" />
            {errors.municipio && <div className="error">{errors.municipio}</div>}
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>{L("Estado", "State")}</label>
            <input type="text" name="state" defaultValue="PR" />
          </div>
          <div className="field">
            <label>{L("Código postal", "Zip")}</label>
            <input type="text" name="zip" />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>{L("Años en el negocio", "Years in Business")}</label>
            <input type="number" name="yearsInBusiness" min="0" />
          </div>
          <div className="field">
            <label>{L("Ingresos anuales (USD)", "Annual Revenue (USD)")}</label>
            <input type="number" name="revenue" min="0" step="1000" />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>{L("Cuadrillas activas", "Active Crews")}</label>
            <input type="number" name="activeCrews" min="0" />
          </div>
          <div className="field">
            <label>
              {L("Capacidad de fianza por proyecto (USD)", "Single-Project Bond Capacity (USD)")}
            </label>
            <input type="number" name="bondSingle" min="0" step="1000" />
          </div>
        </div>

        <div className="check">
          <input type="checkbox" id="canMeetVolume" name="canMeetVolume" />
          <label htmlFor="canMeetVolume">
            {L(
              "Nuestra empresa puede cumplir con el volumen de trabajo proyectado por Byrdson.",
              "Our firm can meet Byrdson's projected work volume."
            )}
          </label>
        </div>
        <div className="check">
          <input type="checkbox" id="hasLineOfCredit" name="hasLineOfCredit" />
          <label htmlFor="hasLineOfCredit">
            {L(
              "Tenemos una línea de crédito comercial establecida.",
              "We have an established business line of credit."
            )}
          </label>
        </div>
        <div className="check">
          <input type="checkbox" id="bonded" name="bonded" />
          <label htmlFor="bonded">{L("Estamos afianzados.", "We are bonded.")}</label>
        </div>
      </section>

      {/* Section 2 */}
      <section className="section">
        <h2>2. {L("Punto de Contacto y Contabilidad", "Point of Contact & Accounting")}</h2>
        <h3 className="subhead">{L("Punto de contacto", "Point of Contact")}</h3>
        <div className="row">
          <div className="field">
            <label>{L("Nombre completo", "Full Name")}</label>
            <input type="text" name="contactName" />
          </div>
          <div className="field">
            <label>
              {L("Correo electrónico", "Email")}
              {REQUIRE_EMAIL_VERIFICATION && <span className="req"> *</span>}
            </label>
            <input
              type="email"
              name="contactEmail"
              value={contactEmail}
              onChange={(ev) => onContactEmailChange(ev.target.value)}
            />
          </div>
        </div>

        {REQUIRE_EMAIL_VERIFICATION && (
          <div className="field">
            {!emailVerified ? (
              <>
                <div className="otp-row">
                  <button type="button" className="btn-secondary" onClick={sendOtp} disabled={otpBusy}>
                    {otpSent
                      ? L("Reenviar código", "Resend code")
                      : L("Enviar código de verificación", "Send verification code")}
                  </button>
                  {otpSent && (
                    <>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder={L("Código de 6 dígitos", "6-digit code")}
                        value={otpCode}
                        onChange={(ev) => setOtpCode(ev.target.value.replace(/\D/g, ""))}
                        style={{ maxWidth: 170 }}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={verifyOtpCode}
                        disabled={otpBusy || otpCode.trim().length !== 6}
                      >
                        {L("Verificar", "Verify")}
                      </button>
                    </>
                  )}
                </div>
                <p className="hint">
                  {L(
                    "Debe verificar su correo de contacto para poder enviar la solicitud.",
                    "You must verify your contact email to submit the application."
                  )}
                </p>
              </>
            ) : (
              <p className="otp-ok">{L("Correo verificado ✓", "Email verified ✓")}</p>
            )}
            {otpMsg && (
              <div className={otpMsg.type === "ok" ? "otp-ok" : "error"}>{otpMsg.text}</div>
            )}
          </div>
        )}

        <div className="field">
          <label>{L("Teléfono", "Phone")}</label>
          <input type="tel" name="contactPhone" />
        </div>

        <h3 className="subhead">{L("Gerente de contabilidad", "Accounting Manager")}</h3>
        <div className="row">
          <div className="field">
            <label>{L("Nombre completo", "Full Name")}</label>
            <input type="text" name="accountingName" />
          </div>
          <div className="field">
            <label>{L("Correo electrónico", "Email")}</label>
            <input type="email" name="accountingEmail" />
          </div>
        </div>
        <div className="field">
          <label>{L("Teléfono", "Phone")}</label>
          <input type="tel" name="accountingPhone" />
        </div>
      </section>

      {/* Section 3 */}
      <section className="section">
        <h2>3. {L("Documentos de Cumplimiento", "Compliance Uploads")}</h2>
        <p className="hint">{L("Solo PDF, máximo 10MB cada uno.", "PDF only, max 10MB each.")}</p>
        {UPLOADS.map((u) => (
          <div className="field" key={u.key}>
            <label>{L(u.es, u.en)}</label>
            <input type="file" name={`file_${u.key}`} accept="application/pdf" />
            {errors[`file_${u.key}`] && (
              <div className="error">{errors[`file_${u.key}`]}</div>
            )}
          </div>
        ))}
      </section>

      {/* Section 4 */}
      <section className="section">
        <h2>4. {L("Referencias Comerciales", "Trade References")}</h2>
        <p className="hint">
          {L(
            "Proporcione hasta tres referencias. Nuestro equipo de cumplimiento las verifica después del envío.",
            "Provide up to three references. Our compliance team verifies these after submission."
          )}
        </p>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div className="row">
              <div className="field">
                <label>
                  {L("Referencia", "Reference")} {i + 1} — {L("Nombre", "Name")}
                </label>
                <input type="text" name={`refName${i}`} />
              </div>
              <div className="field">
                <label>{L("Empresa", "Company")}</label>
                <input type="text" name={`refCompany${i}`} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>{L("Teléfono", "Phone")}</label>
                <input type="tel" name={`refPhone${i}`} />
              </div>
              <div className="field">
                <label>{L("Correo electrónico", "Email")}</label>
                <input type="email" name={`refEmail${i}`} />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Section 5 */}
      <section className="section">
        <h2>
          5. {L(MSA_TITLE, "Master Services Agreement")}
        </h2>
        <p className="hint">
          {L(
            "Lea el acuerdo completo a continuación (versión oficial en español). Desplácese hasta el final para poder firmar.",
            "Read the full agreement below (official Spanish version). Scroll to the end to enable signing."
          )}
        </p>
        <div className="msa-box" ref={msaRef} onScroll={onMsaScroll} tabIndex={0}>
          <MsaContent text={MSA_TEXT_ES} />
        </div>
        <div className={msaRead ? "msa-status read" : "msa-status"}>
          {msaRead
            ? L("✓ Ha leído el acuerdo completo.", "✓ You have read the full agreement.")
            : L(
                "↓ Desplácese hasta el final del acuerdo para habilitar la firma.",
                "↓ Scroll to the end of the agreement to enable signing."
              )}
        </div>
      </section>

      {/* Section 6 */}
      <section className="section">
        <h2>6. {L("Ejecución Vinculante", "Binding Execution")}</h2>

        {!msaRead && (
          <p className="hint" style={{ color: "var(--danger)", fontWeight: 600 }}>
            {L(
              "Debe leer el Acuerdo Maestro completo (sección 5) antes de poder firmar.",
              "You must read the full Master Services Agreement (section 5) before you can sign."
            )}
          </p>
        )}

        <div className={msaRead ? "attest" : "attest locked"}>
          <div className="check">
            <input
              type="checkbox"
              id="attestation"
              name="attestation"
              disabled={!msaRead}
            />
            <label htmlFor="attestation">
              {L(
                "AL MARCAR ESTA CASILLA, ACEPTO EXPRESAMENTE QUEDAR OBLIGADO POR TODOS LOS TÉRMINOS, CONDICIONES Y DISPOSICIONES DEL CONTRATO MAESTRO DE SERVICIO DETALLADO ARRIBA. CERTIFICO QUE LA INFORMACIÓN PROPORCIONADA EN ESTE FORMULARIO ES VERDADERA Y CORRECTA.",
                "BY CHECKING THIS BOX, I EXPRESSLY AGREE TO BE BOUND BY ALL THE TERMS, CONDITIONS, AND PROVISIONS OF THE MASTER SERVICES AGREEMENT DETAILED ABOVE. I CERTIFY THAT THE INFORMATION PROVIDED IN THIS FORM IS TRUE AND ACCURATE."
              )}{" "}
              <span className="req">*</span>
            </label>
          </div>
          {errors.attestation && <div className="error">{errors.attestation}</div>}
        </div>

        <div className={msaRead ? "attest" : "attest locked"} style={{ marginTop: 12 }}>
          <div className="check">
            <input
              type="checkbox"
              id="personalGuarantee"
              name="personalGuarantee"
              disabled={!msaRead}
            />
            <label htmlFor="personalGuarantee">
              {L(
                "GARANTÍA PERSONAL: Yo/Nosotros garantizamos personal e incondicionalmente el pago completo y puntual a todos los empleados, agentes, subcontratistas, proveedores de materiales y de mano de obra del Subcontratista.",
                "PERSONAL GUARANTEE: I/We personally and unconditionally guarantee the full and timely payment to all of the Subcontractor's employees, agents, subcontractors, material suppliers, and labor providers."
              )}{" "}
              <span className="req">*</span>
            </label>
          </div>
          {errors.personalGuarantee && (
            <div className="error">{errors.personalGuarantee}</div>
          )}
        </div>

        <h3 className="subhead" style={{ marginTop: 18 }}>
          {L("Firma(s)", "Signature(s)")}
        </h3>
        <p className="hint">{signerInstruction()}</p>

        {signers.map((s, i) => (
          <div className="signer-row" key={s.id}>
            <div className="row">
              <div className="field">
                <label>
                  {L(
                    "Nombre legal completo (en letra de molde)",
                    "Full Legal Name (printed)"
                  )}{" "}
                  <span className="req">*</span>
                </label>
                <input
                  type="text"
                  value={s.name}
                  onChange={(ev) => updateSigner(i, "name", ev.target.value)}
                />
              </div>
              <div className="field">
                <label>
                  {L("Título / Posición", "Title / Position")} <span className="req">*</span>
                </label>
                <input
                  type="text"
                  value={s.title}
                  onChange={(ev) => updateSigner(i, "title", ev.target.value)}
                />
              </div>
            </div>
            <div className="field sig-field">
              <label>
                {L("Firma", "Signature")} <span className="req">*</span>
              </label>
              <SignaturePad
                clearLabel={L("Borrar", "Clear")}
                hint={L(
                  "Firme aquí con el mouse o el dedo",
                  "Sign here with your mouse or finger"
                )}
                onChange={(dataUrl) => updateSigner(i, "signature", dataUrl)}
              />
            </div>
            {errors[`signer${i}`] && <div className="error">{errors[`signer${i}`]}</div>}
            {entityType === "partnership" && signers.length > 1 && (
              <button
                type="button"
                className="btn-link"
                onClick={() => removeSigner(i)}
              >
                {L("Eliminar socio", "Remove partner")}
              </button>
            )}
          </div>
        ))}

        {entityType === "partnership" && (
          <button type="button" className="btn-secondary" onClick={addSigner}>
            + {L("Añadir socio", "Add partner")}
          </button>
        )}
      </section>

      <div className="section">
        {tsEnabled && (
          <div className="field">
            <label>{L("Verificación de seguridad", "Security check")}</label>
            <div ref={tsRef} className="cf-turnstile" />
          </div>
        )}
        <button className="btn" type="submit" disabled={submitting}>
          {submitting
            ? L("Enviando…", "Submitting…")
            : L("Enviar solicitud", "Submit Application")}
        </button>
        {uploadStatus && <span className="upload-status">{uploadStatus}</span>}
      </div>
    </form>
  );
}
