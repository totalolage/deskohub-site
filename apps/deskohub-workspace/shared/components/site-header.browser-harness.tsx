import { createRoot } from "react-dom/client";
import { isLocale, m } from "@/features/i18n";
import { MinimalSiteHeader } from "./minimal-site-header";
import { SiteHeader } from "./site-header";

const mountPoint = document.getElementById("site-header-test-root");

if (!mountPoint) {
  throw new Error("The SiteHeader browser harness root is missing.");
}

const locale = mountPoint.dataset.locale;

if (!(locale && isLocale(locale))) {
  throw new Error("The SiteHeader browser harness needs a supported locale.");
}

const languageLabels = {
  "cs-CZ": m.languageCzech({}, { locale }),
  "en-US": m.languageEnglish({}, { locale }),
};
const languageSwitcherLabel = m.languageSwitcherLabel({}, { locale });
const signedIn = mountPoint.dataset.session === "signed-in";
const signInHref = `/${locale}/auth/sign-in`;

// The full header mirrors the production menu so it is measured at its widest.
createRoot(mountPoint).render(
  mountPoint.dataset.variant === "minimal" ? (
    <MinimalSiteHeader
      currentLocale={locale}
      languageLabels={languageLabels}
      languageSwitcherLabel={languageSwitcherLabel}
    />
  ) : (
    <SiteHeader
      account={{
        href: Promise.resolve(signedIn ? `/${locale}/account` : signInHref),
        label: m.accountNavLabel({}, { locale }),
        signInHref,
      }}
      closeNavigationMenuLabel={m.closeNavigationMenuLabel({}, { locale })}
      contactHref={`/${locale}/reservation/cowork`}
      contactLabel={m.reservationNavCta({}, { locale })}
      currentLocale={locale}
      languageLabels={languageLabels}
      languageSwitcherLabel={languageSwitcherLabel}
      localePreference={{
        save: async () => undefined,
        signedIn: Promise.resolve(signedIn),
      }}
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
  )
);
