import { createRoot } from "react-dom/client";
import { isLocale, m } from "@/features/i18n";
import { SiteHeader } from "./site-header";

const mountPoint = document.getElementById("site-header-test-root");

if (!mountPoint) {
  throw new Error("The SiteHeader browser harness root is missing.");
}

const locale = mountPoint.dataset.locale;

if (!(locale && isLocale(locale))) {
  throw new Error("The SiteHeader browser harness needs a supported locale.");
}

const administrator = mountPoint.dataset.administrator === "true";

// Mirrors the full production menu so the header is measured at its widest.
createRoot(mountPoint).render(
  <SiteHeader
    account={{
      href: Promise.resolve(`/${locale}/account`),
      label: m.accountNavLabel({}, { locale }),
      signInHref: `/${locale}/auth/sign-in`,
    }}
    administrator={{
      visible: Promise.resolve(administrator),
      href: `/${locale}/admin`,
      label: m.siteHeaderAdminLabel({}, { locale }),
      ribbonLabel: m.siteHeaderAdminRibbonLabel({}, { locale }),
      ribbonActionLabel: m.siteHeaderAdminRibbonAction({}, { locale }),
    }}
    closeNavigationMenuLabel={m.closeNavigationMenuLabel({}, { locale })}
    contactHref={`/${locale}/reservation/cowork`}
    contactLabel={m.reservationNavCta({}, { locale })}
    currentLocale={locale}
    languageLabels={{
      "cs-CZ": m.languageCzech({}, { locale }),
      "en-US": m.languageEnglish({}, { locale }),
    }}
    languageSwitcherLabel={m.languageSwitcherLabel({}, { locale })}
    links={[
      {
        id: "locationMap",
        label: m.landingNavWhereToFindUs({}, { locale }),
        href: `/${locale}#location-map`,
      },
      {
        id: "meetingRoom",
        label: m.landingNavMeetingRoom({}, { locale }),
        href: `/${locale}/meeting-room`,
      },
      {
        id: "office",
        label: m.landingNavPrivateOffice({}, { locale }),
        href: `/${locale}/reservation/office`,
      },
      {
        id: "gallery",
        label: m.landingNavGallery({}, { locale }),
        href: `/${locale}/gallery`,
      },
      {
        id: "team",
        label: m.landingNavOurTeam({}, { locale }),
        href: `/${locale}/team`,
      },
      {
        id: "faq",
        label: m.landingNavFaq({}, { locale }),
        href: `/${locale}/faq`,
      },
      {
        id: "contact",
        label: m.landingNavContactLabel({}, { locale }),
        href: `/${locale}/contact`,
      },
    ]}
    mobilePrimaryNavigationLabel={m.mobilePrimaryNavigationLabel(
      {},
      { locale }
    )}
    openNavigationMenuLabel={m.openNavigationMenuLabel({}, { locale })}
    primaryNavigationLabel={m.primaryNavigationLabel({}, { locale })}
  />
);
