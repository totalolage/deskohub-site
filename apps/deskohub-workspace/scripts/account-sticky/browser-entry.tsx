import { type ReactNode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type AccountSection,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import "../../app/globals.css";

const labels = {
  navigation: "Account navigation",
  mobileSection: "Account section",
  sections: {
    billing: "Billing and invoices",
    danger: "Danger zone",
    legal: "Legal and privacy",
    profile: "Profile and identity",
    reservations: "Reservations",
  },
} as const;

type ContentVariant = "short" | "tall";
type SidebarVariant = "normal" | "tall";

const contentLines = {
  short: ["short-1", "short-2", "short-3"],
  tall: [
    "tall-1",
    "tall-2",
    "tall-3",
    "tall-4",
    "tall-5",
    "tall-6",
    "tall-7",
    "tall-8",
    "tall-9",
    "tall-10",
    "tall-11",
    "tall-12",
    "tall-13",
    "tall-14",
    "tall-15",
    "tall-16",
    "tall-17",
    "tall-18",
  ],
} as const satisfies Record<ContentVariant, readonly string[]>;

const readVariant = <T extends string>(
  name: string,
  values: readonly T[],
  fallback: T
): T => {
  const value = new URLSearchParams(window.location.search).get(name);
  return values.find((candidate) => candidate === value) ?? fallback;
};

const readFixtureVariants = () => ({
  content: readVariant("content", ["short", "tall"], "short"),
  sidebar: readVariant("sidebar", ["normal", "tall"], "normal"),
});

function SyntheticContent({
  activeSection,
  variant,
}: {
  readonly activeSection: AccountSection;
  readonly variant: ContentVariant;
}) {
  return (
    <section
      aria-labelledby="account-sticky-content-heading"
      data-account-sticky-content
      style={{
        backgroundColor: "rgba(255, 255, 255, 0.76)",
        border: "1px solid #dfe4ec",
        borderRadius: "20px",
        minHeight: variant === "tall" ? "1600px" : "320px",
        padding: "24px",
      }}
    >
      <h2 id="account-sticky-content-heading">
        {labels.sections[activeSection]}
      </h2>
      {contentLines[variant].map((line) => (
        <p key={line}>
          Synthetic account content {line}. This content exists only to exercise
          the document scroll geometry.
        </p>
      ))}
    </section>
  );
}

function SyntheticSidebarFooter({
  variant,
}: {
  readonly variant: SidebarVariant;
}) {
  return (
    <div
      data-account-sticky-sidebar-footer
      style={{
        backgroundColor: "#eeebe5",
        border: "1px solid #dfe4ec",
        borderRadius: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        justifyContent: variant === "tall" ? "flex-end" : "flex-start",
        minHeight: variant === "tall" ? "820px" : "144px",
        padding: "16px",
      }}
    >
      <h2 style={{ margin: 0 }}>Need help?</h2>
      <p style={{ margin: 0 }}>
        These buttons are synthetic sidebar footer controls.
      </p>
      <button id="account-sticky-sidebar-help" type="button">
        Sidebar help button
      </button>
      <button id="account-sticky-sidebar-final" type="button">
        Final sidebar footer button
      </button>
    </div>
  );
}

function SyntheticSiteHeader() {
  return (
    <header
      data-account-sticky-site-header
      style={{
        alignItems: "center",
        backgroundColor: "#00024f",
        color: "white",
        display: "flex",
        height: "var(--site-header-height)",
        insetBlockStart: 0,
        insetInline: 0,
        paddingInline: "24px",
        position: "fixed",
        width: "100%",
        zIndex: 10,
      }}
    >
      Synthetic site header
    </header>
  );
}

function SyntheticPageFooter() {
  return (
    <footer
      id="account-sticky-page-footer"
      data-account-sticky-page-footer
      style={{
        backgroundColor: "#00024f",
        color: "white",
        minHeight: "160px",
        padding: "32px 24px",
      }}
    >
      <h2 id="account-sticky-page-footer-heading">Public page footer</h2>
      <a href="#account-sticky-page-footer" style={{ color: "white" }}>
        Public page footer link
      </a>
    </footer>
  );
}

function Fixture() {
  const { content, sidebar } = readFixtureVariants();
  const [activeSection, setActiveSection] = useState<AccountSection>("profile");

  useLayoutEffect(() => {
    document.documentElement.dataset.accountStickyReady = "true";
  }, []);

  const children: ReactNode = (
    <SyntheticContent activeSection={activeSection} variant={content} />
  );

  return (
    <>
      <SyntheticSiteHeader />
      <div
        data-account-sticky-fixture
        data-content-variant={content}
        data-sidebar-variant={sidebar}
      >
        <AccountShell
          activeSection={activeSection}
          labels={labels}
          onSectionChange={setActiveSection}
          reservationCount={2}
          signOut={<button type="button">Synthetic sign out</button>}
          sidebarFooter={<SyntheticSidebarFooter variant={sidebar} />}
          title="Synthetic workspace account"
        >
          {children}
        </AccountShell>
      </div>
      <SyntheticPageFooter />
    </>
  );
}

const rootElement = document.getElementById("account-sticky-root");
if (!rootElement) throw new Error("Account sticky fixture root is missing");

createRoot(rootElement).render(<Fixture />);
