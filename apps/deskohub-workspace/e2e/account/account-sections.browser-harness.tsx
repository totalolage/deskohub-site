import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountShell } from "@/features/account/components/shell/account-shell";
import type { AccountSection } from "@/features/account/sections";
import { m } from "@/features/i18n";

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

/** Each panel renders the landmark `accountSectionLandmarks` names. */
const SectionPanel = ({ section }: { readonly section: AccountSection }) => {
  switch (section) {
    case "reservations":
      return <h2 id="account-reservations-past-title">Past reservations</h2>;
    case "referrals":
      return <section data-screen="referrals-screen" />;
    case "profile":
      return (
        <section data-screen="profile-screen">
          <input id="account-profile-first-name" />
        </section>
      );
    case "assistants":
      return <h2 id="account-assistants-title">Connected assistants</h2>;
    case "billing":
      return <select id="account-profile-billing-kind" />;
    case "legal":
      return <a href={`/${locale}/privacy-policy`}>Privacy policy</a>;
    case "danger":
      return (
        <button id="delete-account-trigger" type="button">
          Delete account
        </button>
      );
    default:
      return null;
  }
};

function AccountSectionsHarness() {
  const [activeSection, setActiveSection] =
    useState<AccountSection>("reservations");

  return (
    <main>
      <AccountShell
        activeSection={activeSection}
        locale={locale}
        onSectionChange={setActiveSection}
        reservationCount={3}
        signOut={
          <button type="button">{m.accountSignOut({}, { locale })}</button>
        }
      >
        {sections.map((section) => (
          <div hidden={activeSection !== section} key={section}>
            <SectionPanel section={section} />
          </div>
        ))}
      </AccountShell>
    </main>
  );
}

const mountPoint = document.getElementById("account-sections-test-root");

if (!mountPoint) {
  throw new Error("The account sections browser harness root is missing.");
}

createRoot(mountPoint).render(<AccountSectionsHarness />);
