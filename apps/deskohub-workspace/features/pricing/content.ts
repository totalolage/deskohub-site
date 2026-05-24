import {
  formatWorkspaceProductCurrencyAmount,
  getWorkspaceProductByTier,
  type WorkspaceProductTier,
  workspaceProductCatalog,
} from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";

type PricingDocumentCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  coworkingTitle: string;
  coworkingLead: string;
  importantInfoTitle: string;
  tariffIncludesLabel: string;
  eventRentalTitle: string;
  eventRentalLead: string;
  eventRentalCriteria: string[];
  eventRentalContact: string;
};

export type PricingTariff = {
  id: "basic" | "plus" | "profi";
  reservationTier: WorkspaceProductTier;
  name: string;
  price: string;
  description: string;
  includes: string[];
  featured: boolean;
};

export type EventPricingSummary = {
  name: string;
  price: string;
  description: string;
};

export type PricingContent = {
  footerLabel: string;
  metadataTitle: string;
  metadataDescription: string;
  document: PricingDocumentCopy;
  tariffs: PricingTariff[];
  importantInfo: string[];
  eventPricing: EventPricingSummary;
};

type PricingTariffMessageKeys = {
  name: keyof typeof m;
  description: keyof typeof m;
  includes: readonly (keyof typeof m)[];
  featured: boolean;
};

const pricingTariffMessageKeys = {
  "basic-day-pass": {
    name: "pricingTariffBasicName",
    description: "pricingTariffBasicDescription",
    includes: [
      "pricingTariffBasicIncludeCowork",
      "pricingTariffBasicIncludeCommonAreas",
    ],
    featured: false,
  },
  "cowork-plus": {
    name: "pricingTariffCoworkName",
    description: "pricingTariffCoworkDescription",
    includes: [
      "pricingTariffCoworkIncludeBasic",
      "pricingTariffCoworkIncludeRefreshments",
    ],
    featured: false,
  },
  "profi-workstation": {
    name: "pricingTariffProfiName",
    description: "pricingTariffProfiDescription",
    includes: [
      "pricingTariffProfiIncludePlus",
      "pricingTariffProfiIncludeWorkstation",
      "pricingTariffProfiIncludeEquipment",
    ],
    featured: false,
  },
} as const satisfies Record<WorkspaceProductTier, PricingTariffMessageKeys>;

const getMessage = (key: keyof typeof m, locale: Locale) => {
  const message = m[key] as (
    inputs: object,
    options: { locale: Locale }
  ) => string;
  return message({}, { locale }) as string;
};

const getMessages = (keys: readonly (keyof typeof m)[], locale: Locale) =>
  keys.map((key) => getMessage(key, locale));

const formatTariffPrice = (
  product: ReturnType<typeof getWorkspaceProductByTier>,
  locale: Locale
) =>
  `${formatWorkspaceProductCurrencyAmount(product, locale)}${m.pricingTariffPricePeriodSuffix({}, { locale })}`;

export function getPricingContent(locale: Locale): PricingContent {
  return {
    footerLabel: m.pricingFooterLabel({}, { locale }),
    metadataTitle: m.pricingMetadataTitle({}, { locale }),
    metadataDescription: m.pricingMetadataDescription({}, { locale }),
    document: {
      eyebrow: m.pricingDocumentEyebrow({}, { locale }),
      title: m.pricingDocumentTitle({}, { locale }),
      intro: m.pricingDocumentIntro({}, { locale }),
      coworkingTitle: m.pricingDocumentCoworkingTitle({}, { locale }),
      coworkingLead: m.pricingDocumentCoworkingLead({}, { locale }),
      importantInfoTitle: m.pricingDocumentImportantInfoTitle({}, { locale }),
      tariffIncludesLabel: m.pricingTariffIncludesLabel({}, { locale }),
      eventRentalTitle: m.pricingDocumentEventRentalTitle({}, { locale }),
      eventRentalLead: m.pricingDocumentEventRentalLead({}, { locale }),
      eventRentalCriteria: [
        m.pricingDocumentEventRentalCriterionType({}, { locale }),
        m.pricingDocumentEventRentalCriterionAttendees({}, { locale }),
        m.pricingDocumentEventRentalCriterionDuration({}, { locale }),
        m.pricingDocumentEventRentalCriterionServices({}, { locale }),
      ],
      eventRentalContact: m.pricingDocumentEventRentalContact({}, { locale }),
    },
    tariffs: workspaceProductCatalog.map((product) => {
      const catalogProduct = getWorkspaceProductByTier(product.tier);
      const tariffMessages = pricingTariffMessageKeys[product.tier];

      return {
        id: catalogProduct.tariffId,
        reservationTier: catalogProduct.tier,
        name: getMessage(tariffMessages.name, locale),
        price: formatTariffPrice(catalogProduct, locale),
        description: getMessage(tariffMessages.description, locale),
        includes: getMessages(tariffMessages.includes, locale),
        featured: tariffMessages.featured,
      };
    }),
    importantInfo: [
      m.pricingImportantInfoFinalPrices({}, { locale }),
      m.pricingImportantInfoSinglePerson({}, { locale }),
      m.pricingImportantInfoNoRefundAfterPin({}, { locale }),
      m.pricingImportantInfoAvailability({}, { locale }),
    ],
    eventPricing: {
      name: m.pricingEventPricingName({}, { locale }),
      price: m.pricingEventPricingPrice({}, { locale }),
      description: m.pricingEventPricingDescription({}, { locale }),
    },
  };
}
