import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AccountSection } from "@/features/account/sections";
import { m } from "@/features/i18n";
import { AccountSectionPanel } from "./account-section-panel";
import { AccountShell } from "./account-shell";

const locale = "en-US" as const;
const sections = [
  "reservations",
  "referrals",
  "profile",
  "assistants",
  "billing",
  "legal",
  "danger",
] as const satisfies readonly AccountSection[];
const sectionLabels = {
  reservations: m.accountSectionReservations({}, { locale }),
  referrals: m.accountSectionReferrals({}, { locale }),
  profile: m.accountSectionProfile({}, { locale }),
  security: m.accountSectionSecurity({}, { locale }),
  assistants: m.accountSectionAssistants({}, { locale }),
  billing: m.accountSectionBilling({}, { locale }),
  legal: m.accountSectionLegal({}, { locale }),
  danger: m.accountSectionDanger({}, { locale }),
} as const satisfies Readonly<Record<AccountSection, string>>;

function AccountShellHarness() {
  const [activeSection, setActiveSection] =
    useState<AccountSection>("reservations");

  return (
    <AccountShell
      activeSection={activeSection}
      labels={{
        mobileSection: m.accountSectionLabel({}, { locale }),
        navigation: m.accountNavigationLabel({}, { locale }),
        sections: sectionLabels,
      }}
      onSectionChange={setActiveSection}
      reservationCount={3}
      sectionHref={(section) => `/${locale}/account/${section}`}
      sidebarFooter={<p>Synthetic help card</p>}
      signOut={
        <button type="button">{m.accountSignOut({}, { locale })}</button>
      }
      title={m.accountTitle({}, { locale })}
    >
      {sections.map((section) => (
        <div
          data-account-panel={section}
          hidden={activeSection !== section}
          key={section}
        >
          <AccountSectionPanel
            title={sectionLabels[section]}
            variant={section === "danger" ? "destructive" : "default"}
          >
            <label className="grid gap-2">
              Synthetic field
              <input className="w-full rounded-md border px-3 py-2" />
            </label>
            <div data-synthetic-long-content="" style={{ height: "2400px" }} />
          </AccountSectionPanel>
        </div>
      ))}
    </AccountShell>
  );
}

const mountPoint = document.getElementById("account-shell-test-root");

if (!mountPoint) {
  throw new Error("The AccountShell browser harness root is missing.");
}

createRoot(mountPoint).render(<AccountShellHarness />);
