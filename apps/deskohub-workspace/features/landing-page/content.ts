import { m, type WorkspaceLocale } from "@/features/i18n";

export type LandingCopy = {
  ui: {
    heroVisualTag: string;
    heroStatsTitle: string;
    eventsCateringTitle: string;
    teamPerksTitle: string;
    heroPrimaryImageAlt: string;
    heroSecondaryImageAlt: string;
  };
  nav: {
    links: Array<{ label: string; href: string }>;
    contactLabel: string;
  };
  hero: {
    kicker: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
    highlights: string[];
    stats: Array<{ label: string; value: string }>;
  };
  rozcestnik: {
    title: string;
    description: string;
    bar: {
      title: string;
      text: string;
    };
    workspace: {
      title: string;
      text: string;
    };
    microcopy: string;
  };
  ttrpg: {
    sectionLabel: string;
    title: string;
    text: string;
    features: Array<{ label: string; text: string }>;
    cta: string;
    detail: string;
  };
  eventsWorkshops: {
    sectionLabel: string;
    title: string;
    text: string;
    features: string[];
    foodCallout: string;
    cta: string;
    fullSpaceRental: {
      title: string;
      detail: string;
    };
  };
  coworkWorkstation: {
    sectionLabel: string;
    title: string;
    officeTitle: string;
    officeText: string;
    workstationTitle: string;
    workstationText: string;
  };
  pricing: {
    title: string;
    subtitle: string;
    featuredBadge: string;
    items: Array<{
      name: string;
      price: string;
      text: string;
      featured?: boolean;
    }>;
  };
  privateOfficeMeetingRoom: {
    sectionLabel: string;
    title: string;
    name: string;
    price: string;
    text: string;
    perks: string[];
    meetingRoom: {
      title: string;
      text: string;
    };
  };
  universum: {
    title: string;
    lead: string;
    paragraphs: string[];
  };
  faqContactFooter: {
    title: string;
    items: Array<{ question: string; answer: string }>;
    contactTitle: string;
    contactLead: string;
    contactCta: string;
    barCta: string;
    legal: string;
  };
};

export function getLandingCopy(locale: WorkspaceLocale): LandingCopy {
  const option = { locale } as const;

  const navLinks = [
    { label: m.landingNavTtrpg({}, option), href: "#ttrpg" },
    { label: m.landingNavEvents({}, option), href: "#eventy" },
    { label: m.landingNavCowork({}, option), href: "#cowork" },
    { label: m.landingNavPricing({}, option), href: "#cenik" },
    { label: m.landingNavPrivateOffice({}, option), href: "#office" },
    { label: m.landingNavUniversum({}, option), href: "#about" },
    { label: m.landingNavFaqContact({}, option), href: "#kontakt" },
  ];

  if (locale === "en-US") {
    navLinks.unshift({
      label: m.landingNavOverview({}, option),
      href: "#rozcestnik",
    });
  }

  return {
    ui: {
      heroVisualTag: m.landingUiHeroVisualTag({}, option),
      heroStatsTitle: m.landingUiHeroStatsTitle({}, option),
      eventsCateringTitle: m.landingUiEventsCateringTitle({}, option),
      teamPerksTitle: m.landingUiTeamPerksTitle({}, option),
      heroPrimaryImageAlt: m.landingUiHeroPrimaryImageAlt({}, option),
      heroSecondaryImageAlt: m.landingUiHeroSecondaryImageAlt({}, option),
    },
    nav: {
      links: navLinks,
      contactLabel: m.landingNavContactLabel({}, option),
    },
    hero: {
      kicker: m.landingHeroKicker({}, option),
      title: m.landingHeroTitle({}, option),
      subtitle: m.landingHeroSubtitle({}, option),
      primaryCta: m.landingHeroPrimaryCta({}, option),
      secondaryCta: m.landingHeroSecondaryCta({}, option),
      highlights: [
        m.landingHeroHighlightOne({}, option),
        m.landingHeroHighlightTwo({}, option),
        m.landingHeroHighlightThree({}, option),
      ],
      stats: [
        {
          label: m.landingHeroStatOneLabel({}, option),
          value: m.landingHeroStatOneValue({}, option),
        },
        {
          label: m.landingHeroStatTwoLabel({}, option),
          value: m.landingHeroStatTwoValue({}, option),
        },
        {
          label: m.landingHeroStatThreeLabel({}, option),
          value: m.landingHeroStatThreeValue({}, option),
        },
      ],
    },
    rozcestnik: {
      title: m.landingRozcestnikTitle({}, option),
      description: m.landingRozcestnikDescription({}, option),
      bar: {
        title: m.landingRozcestnikBarTitle({}, option),
        text: m.landingRozcestnikBarText({}, option),
      },
      workspace: {
        title: m.landingRozcestnikWorkspaceTitle({}, option),
        text: m.landingRozcestnikWorkspaceText({}, option),
      },
      microcopy: m.landingRozcestnikMicrocopy({}, option),
    },
    ttrpg: {
      sectionLabel: m.landingTtrpgSectionLabel({}, option),
      title: m.landingTtrpgTitle({}, option),
      text: m.landingTtrpgText({}, option),
      features: [
        {
          label: m.landingTtrpgFeatureOneLabel({}, option),
          text: m.landingTtrpgFeatureOneText({}, option),
        },
        {
          label: m.landingTtrpgFeatureTwoLabel({}, option),
          text: m.landingTtrpgFeatureTwoText({}, option),
        },
        {
          label: m.landingTtrpgFeatureThreeLabel({}, option),
          text: m.landingTtrpgFeatureThreeText({}, option),
        },
      ],
      cta: m.landingTtrpgCta({}, option),
      detail: m.landingTtrpgDetail({}, option),
    },
    eventsWorkshops: {
      sectionLabel: m.landingEventsSectionLabel({}, option),
      title: m.landingEventsTitle({}, option),
      text: m.landingEventsText({}, option),
      features: [
        m.landingEventsFeatureOne({}, option),
        m.landingEventsFeatureTwo({}, option),
        m.landingEventsFeatureThree({}, option),
      ],
      foodCallout: m.landingEventsFoodCallout({}, option),
      cta: m.landingEventsCta({}, option),
      fullSpaceRental: {
        title: m.landingEventsFullSpaceRentalTitle({}, option),
        detail: m.landingEventsFullSpaceRentalDetail({}, option),
      },
    },
    coworkWorkstation: {
      sectionLabel: m.landingCoworkSectionLabel({}, option),
      title: m.landingCoworkTitle({}, option),
      officeTitle: m.landingCoworkOfficeTitle({}, option),
      officeText: m.landingCoworkOfficeText({}, option),
      workstationTitle: m.landingCoworkWorkstationTitle({}, option),
      workstationText: m.landingCoworkWorkstationText({}, option),
    },
    pricing: {
      title: m.landingPricingTitle({}, option),
      subtitle: m.landingPricingSubtitle({}, option),
      featuredBadge: m.landingPricingFeaturedBadge({}, option),
      items: [
        {
          name: m.landingPricingItemOneName({}, option),
          price: m.landingPricingItemOnePrice({}, option),
          text: m.landingPricingItemOneText({}, option),
        },
        {
          name: m.landingPricingItemTwoName({}, option),
          price: m.landingPricingItemTwoPrice({}, option),
          text: m.landingPricingItemTwoText({}, option),
          featured: true,
        },
        {
          name: m.landingPricingItemThreeName({}, option),
          price: m.landingPricingItemThreePrice({}, option),
          text: m.landingPricingItemThreeText({}, option),
        },
        {
          name: m.landingPricingItemFourName({}, option),
          price: m.landingPricingItemFourPrice({}, option),
          text: m.landingPricingItemFourText({}, option),
        },
      ],
    },
    privateOfficeMeetingRoom: {
      sectionLabel: m.landingPrivateOfficeSectionLabel({}, option),
      title: m.landingPrivateOfficeTitle({}, option),
      name: m.landingPrivateOfficeName({}, option),
      price: m.landingPrivateOfficePrice({}, option),
      text: m.landingPrivateOfficeText({}, option),
      perks: [
        m.landingPrivateOfficePerkOne({}, option),
        m.landingPrivateOfficePerkTwo({}, option),
        m.landingPrivateOfficePerkThree({}, option),
      ],
      meetingRoom: {
        title: m.landingMeetingRoomTitle({}, option),
        text: m.landingMeetingRoomText({}, option),
      },
    },
    universum: {
      title: m.landingUniversumTitle({}, option),
      lead: m.landingUniversumLead({}, option),
      paragraphs: [
        m.landingUniversumParagraphOne({}, option),
        m.landingUniversumParagraphTwo({}, option),
        m.landingUniversumParagraphThree({}, option),
      ],
    },
    faqContactFooter: {
      title: m.landingFaqTitle({}, option),
      items: [
        {
          question: m.landingFaqItemOneQuestion({}, option),
          answer: m.landingFaqItemOneAnswer({}, option),
        },
        {
          question: m.landingFaqItemTwoQuestion({}, option),
          answer: m.landingFaqItemTwoAnswer({}, option),
        },
        {
          question: m.landingFaqItemThreeQuestion({}, option),
          answer: m.landingFaqItemThreeAnswer({}, option),
        },
      ],
      contactTitle: m.landingFooterContactTitle({}, option),
      contactLead: m.landingFooterContactLead({}, option),
      contactCta: m.landingFooterContactCta({}, option),
      barCta: m.landingFooterBarCta({}, option),
      legal: m.landingFooterLegal({}, option),
    },
  };
}
