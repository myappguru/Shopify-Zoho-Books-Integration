import { useLocation, useNavigate } from "react-router";
import LegacySettings, { loader, action } from "../components/settings-legacy";
import AccountSettings from "./app.settings.account";

export { loader, action };

export default function SettingsPageRoute() {
  const location = useLocation();
  const navigate = useNavigate();

  if (location.pathname === "/app/settings/account") {
    return <AccountSettings />;
  }

  const handleLegacyNavigation = (event) => {
    const button = event.target.closest?.("button");
    if (button?.textContent?.trim() === "Account Settings") {
      event.preventDefault();
      event.stopPropagation();
      navigate("/app/settings/account");
    }
  };

  return <div onClickCapture={handleLegacyNavigation}><LegacySettings /></div>;
}
