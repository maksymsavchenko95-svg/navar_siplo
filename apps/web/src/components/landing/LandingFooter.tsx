import { LANDING_CONTENT } from "@/lib/landing-content";

export function LandingFooter() {
  return (
    <footer className="landing-footer" role="contentinfo">
      <div className="landing-footer-container">
        <div className="landing-footer-top">
          <div className="footer-brand-col">
            <div className="landing-brand-wrapper">
              <div className="landing-brand-tile" aria-hidden="true">
                N
              </div>
              <div className="landing-brand-text">
                <span className="landing-brand-title">{LANDING_CONTENT.footer.brandName}</span>
                <span className="landing-brand-sub">{LANDING_CONTENT.footer.tagline}</span>
              </div>
            </div>
            <div className="footer-hackathon-badge">
              <span className="badge-dot" aria-hidden="true" />
              <span>{LANDING_CONTENT.footer.hackathonNote}</span>
            </div>
          </div>

          <nav className="footer-nav-links" aria-label="Посилання підвалу">
            {LANDING_CONTENT.footer.links.map((link, idx) => (
              <a key={idx} href={link.href} className="footer-link">
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="landing-footer-bottom">
          <p className="footer-disclaimer-text">{LANDING_CONTENT.footer.disclaimer}</p>
          <div className="footer-copyright">
            © 2026 NAVAR. Створено для хакатону Сільпо AI Factory. Усі права захищено.
          </div>
        </div>
      </div>
    </footer>
  );
}
