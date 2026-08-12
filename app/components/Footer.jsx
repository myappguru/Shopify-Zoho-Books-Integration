import { useTranslation } from "../locales/translation";
import "./Footer.css";

export default function Footer() {
  const t = useTranslation();

  return (
    <footer className="mag-app-footer">
      <div className="mag-app-footer-content">
        <span>{t("footer.copyright")}</span>

        <span className="mag-footer-divider">|</span>

        <a
          href="https://www.myappgurus.com/policies/privacy-policy"
          target="_blank"
          rel="noreferrer"
        >
          {t("footer.privacyPolicy")}
        </a>

        <span className="mag-footer-divider">|</span>

        <a
          href="https://www.myappgurus.com/policies/terms-of-service"
          target="_blank"
          rel="noreferrer"
        >
          {t("footer.termsOfService")}
        </a>
      </div>
    </footer>
  );
}