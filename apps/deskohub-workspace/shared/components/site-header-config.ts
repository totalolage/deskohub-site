import { m, type WorkspaceLocale } from "@/features/i18n";

const siteHeaderSectionIds = {
  overview: "overview",
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
        label: m.landingNavOverview({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.overview}`),
      },
      {
        label: m.landingNavTtrpg({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.ttrpg}`),
      },
      {
        label: m.landingNavEvents({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.events}`),
      },
      {
        label: m.landingNavCowork({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.cowork}`),
      },
      {
        label: m.landingNavPricing({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.pricing}`),
      },
      {
        label: m.landingNavPrivateOffice({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.privateOffice}`),
      },
      {
        label: m.landingNavFaqContact({}, { locale }),
        href: localizedHash(`#${siteHeaderSectionIds.faqContact}`),
      },
    ],
    contactLabel: m.landingNavContactLabel({}, { locale }),
    contactHref: `${localePath}/contact`,
  };
}

export { siteHeaderSectionIds };
