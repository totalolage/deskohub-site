import { createRoot } from "react-dom/client";
import {
  AccountLayoutShell,
  useAccountLayout,
} from "@/features/account/components/account-layout-shell";
import { isLocale } from "@/features/i18n";

const mountPoint = document.getElementById("account-layout-shell-test-root");

if (!mountPoint) {
  throw new Error("The AccountLayoutShell browser harness root is missing.");
}

const locale = mountPoint.dataset.locale;

if (!(locale && isLocale(locale))) {
  throw new Error(
    "The AccountLayoutShell browser harness needs a supported locale."
  );
}

function ActiveSectionProbe() {
  const { activeSection } = useAccountLayout();
  return <p data-active-section={activeSection}>{activeSection}</p>;
}

createRoot(mountPoint).render(
  <AccountLayoutShell locale={locale} passkeysEnabled referralsEnabled signedIn>
    <ActiveSectionProbe />
  </AccountLayoutShell>
);
