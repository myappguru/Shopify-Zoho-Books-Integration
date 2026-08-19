import { useLocation } from "react-router";
import LegacySettings, { loader, action } from "../components/settings-legacy";
import AccountSettings from "./app.settings.account";

export { loader, action };

export default function SettingsPageRoute() {
  const location = useLocation();

  if (location.pathname === "/app/settings/account") {
    return <AccountSettings />;
  }

  return <LegacySettings />;
}
