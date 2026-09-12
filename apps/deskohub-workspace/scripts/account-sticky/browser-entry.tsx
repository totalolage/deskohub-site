import { type ReactNode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import {
  type AccountSection,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import { type Locale, m } from "@/features/i18n";
import "../../app/globals.css";

const fixtureLocales = ["en-US", "cs-CZ"] as const satisfies readonly Locale[];

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
  locale: readVariant("locale", fixtureLocales, "en-US"),
  sidebar: readVariant("sidebar", ["normal", "tall"], "normal"),
});

type AccountScreenCopy = ReturnType<typeof getAccountScreenCopy>;

function SyntheticContent({
  activeSection,
  copy,
  variant,
}: {
  readonly activeSection: AccountSection;
  readonly copy: AccountScreenCopy;
  readonly variant: ContentVariant;
}) {
  const description = {
    billing: copy.billing.paymentMethodsUnavailable,
    danger: copy.legal.archiveDescription,
    legal: copy.legal.analyticsDescription,
    profile: copy.profile.avatarUnavailableDescription,
    reservations: copy.reservations.unsupportedDescription,
  }[activeSection];

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
        {copy.shell.sections[activeSection]}
      </h2>
      {contentLines[variant].map((line) => (
        <p key={line}>{description}</p>
      ))}
    </section>
  );
}

function SyntheticSidebarFooter({
  locale,
  variant,
}: {
  readonly locale: Locale;
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
      <h2 style={{ margin: 0 }}>{m.accountHelpTitle({}, { locale })}</h2>
      <p style={{ margin: 0 }}>
        {m.accountHelpBody(
          { contact: m.accountHelpContact({}, { locale }) },
          { locale }
        )}
      </p>
      <button id="account-sticky-sidebar-help" type="button">
        {m.accountHelpContact({}, { locale })}
      </button>
      <button id="account-sticky-sidebar-final" type="button">
        {m.accountHelpTitle({}, { locale })}
      </button>
    </div>
  );
}

function SyntheticSiteHeader({ locale }: { readonly locale: Locale }) {
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
      {m.accountTitle({}, { locale })}
    </header>
  );
}

function SyntheticPageFooter({ locale }: { readonly locale: Locale }) {
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
      <h2 id="account-sticky-page-footer-heading">
        {m.footerLegalLabel({}, { locale })}
      </h2>
      <a href="#account-sticky-page-footer" style={{ color: "white" }}>
        {m.footerPrivacyLink({}, { locale })}
      </a>
    </footer>
  );
}

function Fixture() {
  const { content, locale, sidebar } = readFixtureVariants();
  const copy = getAccountScreenCopy(locale);
  const [activeSection, setActiveSection] = useState<AccountSection>("profile");

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.accountStickyReady = "true";
  }, [locale]);

  const children: ReactNode = (
    <SyntheticContent
      activeSection={activeSection}
      copy={copy}
      variant={content}
    />
  );

  return (
    <>
      <SyntheticSiteHeader locale={locale} />
      <div
        data-account-sticky-fixture
        data-content-variant={content}
        data-locale={locale}
        data-sidebar-variant={sidebar}
      >
        <AccountShell
          activeSection={activeSection}
          labels={copy.shell}
          onSectionChange={setActiveSection}
          reservationCount={2}
          signOut={
            <button type="button">{m.accountSignOut({}, { locale })}</button>
          }
          sidebarFooter={
            <SyntheticSidebarFooter locale={locale} variant={sidebar} />
          }
          title={m.accountTitle({}, { locale })}
        >
          {children}
        </AccountShell>
      </div>
      <SyntheticPageFooter locale={locale} />
    </>
  );
}

const rootElement = document.getElementById("account-sticky-root");
if (!rootElement) throw new Error("Account sticky fixture root is missing");

createRoot(rootElement).render(<Fixture />);
