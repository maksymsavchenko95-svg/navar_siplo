import Link from "next/link";

export default function NotFound() {
  return (
    <div className="screen-wrapper">
      <div
        className="app-content"
        style={{ alignItems: "center", justifyContent: "center", flex: 1, gap: 14 }}
      >
        <div className="app-logo-badge" style={{ width: 40, height: 40, fontSize: 20 }}>
          N
        </div>
        <h1 className="screen-hero-title">Сторінку не знайдено</h1>
        <Link href="/" className="btn-primary" style={{ textDecoration: "none" }}>
          На головну
        </Link>
      </div>
    </div>
  );
}
