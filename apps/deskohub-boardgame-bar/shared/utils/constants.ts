export { PATHNAME_HEADER_NAME as PATHNAME_HEADER } from "@deskohub/i18n/next";

export const siteConstants = {
  // Brand information
  brand: {
    name: "DeskoHub",
    legalName: "DeskoHub s.r.o.", // Full legal entity name
    publicDomain: "bar.deskohub.cz",
    emailDomain: "deskohub.cz",
  },
  menu: {
    /**
     * Default currency for menu prices
     * Since Dotypos API doesn't provide currency information
     */
    currency: "CZK" as const,
    /**
     * Category emoji mappings
     * Maps category IDs to their display emojis
     */
    categoryEmojis: {
      // Food categories
      "1736938605506919": "🍿", // Něco na zub (Snacks)
      "1736942001880703": "🥪", // Mám malý hlad (Light hunger)
      "541197685103289": "🍔", // Pořádné jídlo (Proper meal)
      "1737014973909307": "🍰", // Něco sladkého (Something sweet)

      // Drinks categories
      "3901129125927636": "🥤", // Nealkoholické nápoje (Non-alcoholic)
      "1507817247924883": "☕", // Teplé nápoje (Hot drinks)
      "1507864793544647": "🍺", // Alkoholické nápoje (Alcoholic)
      "1507824601258015": "🍹", // Koktejly (Cocktails)
    } satisfies Record<string, string> as Record<string, string>,

    /**
     * Categories grouped by section
     * The keys are section identifiers, values are arrays of category IDs
     * Use scripts/fetch-categories.ts to get the category IDs and names
     */
    categoryGroups: {
      food: [
        "1736938605506919", // Něco na zub
        "1736942001880703", // Mám malý hlad
        "541197685103289", // Pořádné jídlo
        "1737014973909307", // Něco sladkého
      ],
      drinks: [
        "3901129125927636", // Nealkoholické nápoje
        "1507817247924883", // Teplé nápoje
        "1507864793544647", // Alkoholické nápoje
        "1507824601258015", // Koktejly
      ],
    },
    /**
     * Whether to show uncategorized items in the "other" section
     */
    showUncategorized: true,
    /**
     * Default section for items that don't match any group
     * Set to null to hide unmatched items
     */
    defaultSection: "other",
  },
  contact: {
    phone: "+420777060478",
    get fromEmail() {
      return `noreply@mail.${siteConstants.brand.emailDomain}`;
    },
    get infoEmail() {
      return `info@${siteConstants.brand.emailDomain}`;
    },
    get reservationEmail() {
      return `reservations@${siteConstants.brand.emailDomain}`;
    },
    get contactEmail() {
      return `contact@${siteConstants.brand.emailDomain}`;
    },
    get gdprEmail() {
      return `info@${siteConstants.brand.emailDomain}`;
    },
    address: {
      street: "Turnovská 10/430",
      city: "Prague", // English name, will be translated
      cityDistrict: "8",
      postalCode: "180 00",
      countryCode: "CZ",
    },
    coordinates: {
      lat: 50.103136,
      lng: 14.479131,
    },
    ico: "22134921",
  },
  social: {
    instagram: "https://www.instagram.com/deskohub/",
    facebook: "https://www.facebook.com/profile.php?id=61573597011510",
    youtube: "https://www.youtube.com/@Deskohub",
  },
  pricing: {
    entryFee: 50,
    training: {
      hourly: 900,
      daily: 5500,
      halfDay: 2500,
      fullDay: 4500,
      custom: null as number | null, // Indicate custom pricing
    },
    trainingRoom: {
      capacity: 20,
      size: 20, // m²
    },
  },
  tableReservation: {
    validation: {
      guestCount: {
        min: 1,
        max: 10,
      },
      name: {
        min: 2,
        max: 50,
      },
      phone: {
        min: 9,
        max: 20,
      },
      specialRequests: {
        max: 500,
      },
      duration: {
        min: 0.5, // 30 minutes minimum in hours
        increment: 0.5, // 30 minute increments in hours
      },
      time: {
        minuteIncrement: 15,
      },
    },
    defaultValues: {
      datetime: undefined as Date | undefined,
      guestCount: 2,
      needsLargerTable: false,
      needsPrivateSpace: false,
      specialRequests: "",
      name: "",
      email: "",
      phone: "",
      duration: 2, // 2 hours default
    },
    tablesToAssignReservationsTo: ["4480056382382710", "4290682684367411"],
  },
  workingHours: {
    // All times are in Europe/Prague timezone (CET/CEST)
    timezone: "Europe/Prague",
    hours: {
      0: { open: { hrs: 12, mins: 0 }, close: { hrs: 23, mins: 0 } }, // Sunday
      1: { open: { hrs: 17, mins: 0 }, close: { hrs: 23, mins: 0 } }, // Monday
      2: { open: { hrs: 17, mins: 0 }, close: { hrs: 23, mins: 0 } }, // Tuesday
      3: { open: { hrs: 17, mins: 0 }, close: { hrs: 23, mins: 0 } }, // Wednesday
      4: { open: { hrs: 17, mins: 0 }, close: { hrs: 23, mins: 0 } }, // Thursday
      5: { open: { hrs: 17, mins: 0 }, close: { hrs: 23, mins: 0 } }, // Friday
      6: { open: { hrs: 12, mins: 0 }, close: { hrs: 23, mins: 0 } }, // Saturday
    } satisfies Record<
      0 | 1 | 2 | 3 | 4 | 5 | 6,
      {
        open: { hrs: number; mins: number };
        close: { hrs: number; mins: number };
      }
    >,
  },
  // Feature flags - simple constants for prerendered site
  featureFlags: {
    boardGamesList: false,
    boardroomReservations: false,
    contactForm: true,
    tableReservations: true,
    gallery: true,
    menuPdfDownload: true,
  },
};
