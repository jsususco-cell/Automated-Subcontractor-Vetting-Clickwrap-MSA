import Link from "next/link";

export default function Home() {
  return (
    <div className="section">
      <h1>Subcontractor Prequalification</h1>
      <p className="lead">
        Apply to become an approved subcontractor for Byrdson Services. The
        application collects your company information, Puerto Rico compliance
        documents, and your acceptance of our Master Services Agreement.
      </p>
      <p>
        <Link className="btn" href="/apply" style={{ display: "inline-block" }}>
          Start Application
        </Link>
      </p>
    </div>
  );
}
