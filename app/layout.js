import "./globals.css";

export const metadata = {
  title: "Byrdson Services — Subcontractor Application",
  description:
    "Subcontractor prequalification and Master Services Agreement intake.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <strong>Byrdson Services</strong>
            <span className="muted"> — Subcontractor Vetting</span>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
