import type { WorkspaceLocale } from "@/features/i18n";

type PricingRouteSlug = "cennik" | "pricing";

type PricingDocumentCopy = {
  eyebrow: string;
  title: string;
  intro: string;
  coworkingTitle: string;
  coworkingLead: string;
  importantInfoTitle: string;
  eventRentalTitle: string;
  eventRentalLead: string;
  eventRentalCriteria: string[];
  eventRentalContact: string;
};

export type PricingTariff = {
  id: "basic" | "plus" | "profi";
  name: string;
  price: string;
  description: string;
  includes: string[];
  comingSoon: boolean;
  featured: boolean;
};

export type EventPricingSummary = {
  name: string;
  price: string;
  description: string;
};

export type PricingContent = {
  routeSlug: PricingRouteSlug;
  footerLabel: string;
  metadataTitle: string;
  metadataDescription: string;
  document: PricingDocumentCopy;
  tariffs: PricingTariff[];
  importantInfo: string[];
  eventPricing: EventPricingSummary;
};

const pricingByLocale: Record<WorkspaceLocale, PricingContent> = {
  "cs-CZ": {
    routeSlug: "cennik",
    footerLabel: "Ceník služeb",
    metadataTitle: "Ceník služeb | Deskohub Workspace",
    metadataDescription:
      "Přehled denních coworkingových tarifů Deskohub Workspace a informace o individuálním nacenění pronájmu prostoru pro akce.",
    document: {
      eyebrow: "Ceník služeb",
      title: "Deskohub Workspace",
      intro: "Vyberte si tarif podle způsobu, jakým chcete prostor využívat.",
      coworkingTitle: "Coworking – denní vstup",
      coworkingLead:
        "Každý tarif je určen pro jednu osobu a staví na samoobslužném vstupu do klidného pracovního prostoru.",
      importantInfoTitle: "Důležité informace",
      eventRentalTitle: "Pronájem prostoru pro akce",
      eventRentalLead:
        "Cena pronájmu je stanovena individuálně podle konkrétního zadání.",
      eventRentalCriteria: [
        "typu akce",
        "počtu osob",
        "délky trvání",
        "požadovaných služeb",
      ],
      eventRentalContact: "Pro cenovou nabídku nás kontaktujte.",
    },
    tariffs: [
      {
        id: "basic",
        name: "Basic – denní vstup",
        price: "350 Kč / den",
        description:
          "Základní vstup do sdíleného coworkingového prostoru pro soustředěný pracovní den.",
        includes: [
          "přístup do sdíleného coworkingového prostoru",
          "využití společných prostor",
        ],
        comingSoon: true,
        featured: false,
      },
      {
        id: "plus",
        name: "Plus – denní vstup",
        price: "490 Kč / den",
        description:
          "Rozšířený denní vstup pro den, kdy chcete mít občerstvení vyřešené bez přerušování práce.",
        includes: ["vše z tarifu Basic", "občerstvení (káva, polévka)"],
        comingSoon: true,
        featured: false,
      },
      {
        id: "profi",
        name: "Profi – denní vstup",
        price: "550 Kč / den",
        description:
          "Denní tarif pro práci, která potřebuje stabilní zázemí i doplňkové vybavení.",
        includes: [
          "vše z tarifu Plus",
          "vyhrazené pracovní místo",
          "přístup k pracovnímu vybavení (např. monitor)",
        ],
        comingSoon: true,
        featured: false,
      },
    ],
    importantInfo: [
      "Všechny ceny jsou konečné. Nejsme plátci DPH.",
      "Vstup je platný pro jednu osobu.",
      "Po doručení přístupového kódu (PIN) nelze rezervaci zrušit ani vrátit.",
      "Rozsah služeb se může lišit dle aktuální dostupnosti.",
    ],
    eventPricing: {
      name: "Pronájem prostoru pro akce",
      price: "Cena na vyžádání",
      description:
        "Pronájem prostoru naceníme individuálně podle typu akce, počtu osob, délky trvání a požadovaných služeb.",
    },
  },
  "en-US": {
    routeSlug: "pricing",
    footerLabel: "Service Pricing",
    metadataTitle: "Service Pricing | Deskohub Workspace",
    metadataDescription:
      "Overview of Deskohub Workspace daily coworking passes and individual event-space pricing on request.",
    document: {
      eyebrow: "Service Pricing",
      title: "Deskohub Workspace",
      intro: "Choose the tariff that matches how you want to use the space.",
      coworkingTitle: "Coworking - daily pass",
      coworkingLead:
        "Each tariff is valid for one person and is built around self-service access to a calm workspace.",
      importantInfoTitle: "Important Information",
      eventRentalTitle: "Event Space Rental",
      eventRentalLead:
        "Rental pricing is prepared individually based on the specific request.",
      eventRentalCriteria: [
        "type of event",
        "number of attendees",
        "duration",
        "required services",
      ],
      eventRentalContact: "Contact us for a price quote.",
    },
    tariffs: [
      {
        id: "basic",
        name: "Basic - daily pass",
        price: "CZK 350 / day",
        description:
          "Entry-level access to the shared coworking area for a focused working day.",
        includes: [
          "access to the shared coworking space",
          "use of common areas",
        ],
        comingSoon: true,
        featured: false,
      },
      {
        id: "plus",
        name: "Plus - daily pass",
        price: "CZK 490 / day",
        description:
          "Extended daily access for days when you want refreshments covered without interrupting your flow.",
        includes: [
          "everything from the Basic tariff",
          "refreshments (coffee, soup)",
        ],
        comingSoon: true,
        featured: false,
      },
      {
        id: "profi",
        name: "Profi - daily pass",
        price: "CZK 550 / day",
        description:
          "A daily setup for work that benefits from a stable station and extra equipment.",
        includes: [
          "everything from the Plus tariff",
          "reserved workstation",
          "access to work equipment (for example, a monitor)",
        ],
        comingSoon: true,
        featured: false,
      },
    ],
    importantInfo: [
      "All prices are final. We are not a VAT payer.",
      "Each pass is valid for one person.",
      "After the access code (PIN) has been delivered, the booking cannot be cancelled or refunded.",
      "The scope of services may vary based on current availability.",
    ],
    eventPricing: {
      name: "Event Space Rental",
      price: "Price on request",
      description:
        "We quote event-space rental individually based on the event type, attendee count, duration, and required services.",
    },
  },
};

export function getPricingContent(locale: WorkspaceLocale): PricingContent {
  return pricingByLocale[locale];
}

export function getPricingPath(locale: WorkspaceLocale): string {
  return `/${locale}/${pricingByLocale[locale].routeSlug}`;
}
