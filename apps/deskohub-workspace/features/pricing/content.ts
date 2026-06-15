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
  name: PricingMessage;
  description: PricingMessage;
  includes: readonly PricingMessage[];
  featured: boolean;
};

type PricingMessage = (
  inputs: Record<string, never>,
  options: { locale: Locale }
) => string;

const pricingTariffMessageKeys: Record<
  WorkspaceProductTier,
  PricingTariffMessageKeys
> = {
  basic: {
    name: m.pricingTariffBasicName,
    description: m.pricingTariffBasicDescription,
    includes: [
      m.pricingTariffBasicIncludeCowork,
      m.pricingTariffBasicIncludeCommonAreas,
    ],
    featured: false,
  },
  plus: {
    name: m.pricingTariffCoworkName,
    description: m.pricingTariffCoworkDescription,
    includes: [
      m.pricingTariffCoworkIncludeBasic,
      m.pricingTariffCoworkIncludeRefreshments,
    ],
    featured: false,
  },
  profi: {
    name: m.pricingTariffProfiName,
    description: m.pricingTariffProfiDescription,
    includes: [
      m.pricingTariffProfiIncludePlus,
      m.pricingTariffProfiIncludeWorkstation,
      m.pricingTariffProfiIncludeEquipment,
    ],
    featured: true,
  },
};

const getMessages = (messages: readonly PricingMessage[], locale: Locale) =>
  messages.map((message) => message({}, { locale }));

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
        id: catalogProduct.tier,
        reservationTier: catalogProduct.tier,
        name: tariffMessages.name({}, { locale }),
        price: formatTariffPrice(catalogProduct, locale),
        description: tariffMessages.description({}, { locale }),
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
