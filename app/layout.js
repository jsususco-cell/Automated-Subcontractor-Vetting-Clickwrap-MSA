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
          <div className="container header-inner">
            <span className="logo-plate">
              {/* Static asset served from /public */}
              <img className="logo" src="/bi-logo.jpg" alt="Byrdson Services" />
            </span>
            <span className="header-tag">
              <span className="header-tag-main">Subcontractor Prequalification</span>
              <span className="header-tag-sub">Vetting &amp; Master Services Agreement</span>
            </span>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
