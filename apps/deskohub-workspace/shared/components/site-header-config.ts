import { m, type WorkspaceLocale } from "@/features/i18n";

const siteHeaderSectionIds = {
  overview: "overview",
  teambuildings: "teambuildings",
  ttrpg: "ttrpg",
  events: "events",
  cowork: "cowork",
  pricing: "pricing",
  privateOffice: "private-office",
  faqContact: "faq-contact",
} as const;

export function getSiteHeaderConfig(locale: WorkspaceLocale) {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;

  return {
    languageLabels: {
      "cs-CZ": m.languageCzech({}, { locale }),
      "en-US": m.languageEnglish({}, { locale }),
    } satisfies Record<WorkspaceLocale, string>,
    links: [
      {
        label: m.landingNavCowork({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.cowork}`),
      },
      {
        label: m.landingNavEvents({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.events}`),
      },
      {
        label: m.landingNavTtrpg({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.ttrpg}`),
      },
      {
        label: m.landingNavTeambuildings({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.teambuildings}`),
      },
      {
        label: m.landingNavPricing({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.pricing}`),
      },
      {
        label: m.landingNavFaqContact({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.faqContact}`),
      },
      {
        label: m.landingNavContactLabel({}, { locale }),
        href: `${localePath}/contact`,
      },
    ],
    contactLabel: m.reservationNavCta({}, { locale }),
    contactHref: `${localePath}/reservation`,
  };
}

export { siteHeaderSectionIds };
