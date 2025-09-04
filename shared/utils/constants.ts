export const PATHNAME_HEADER = "x-pathname";

export const siteConstants = {
  // Brand information
  brand: {
    name: "DeskoHub",
    legalName: "DeskoHub s.r.o.", // Full legal entity name
    domain: "deskohub.cz",
  },
  menu: {
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

      // Other categories
      "1736813943053711": "🥫", // Omáčky (Sauces)
      "3188160266476616": "🎲", // Hry (Games)
    } as Record<string, string>,

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
      other: [
        "1736813943053711", // Omáčky
        "3188160266476616", // Hry
      ],
    },
    /**
     * Categories to exclude from the menu entirely
     * These categories won't be displayed even if they have items
     */
    excludedCategories: [
      "1736748527670423", // Qerko - slevy
      "1736937582354307", // Qerko - slevy (duplicate)
      "1736748527631391", // Qerko - slevy (duplicate)
      "1736937582251583", // Qerko - slevy (duplicate)
      "2103754035291144", // Suroviny
      "624137811421239", // Pronájem
      "3057623321549468", // Vstup
    ],
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
    phoneTraining: "+420608200377",
    get fromEmail() {
      return `noreply@mail.${siteConstants.brand.domain}`;
    },
    get infoEmail() {
      return `info@${siteConstants.brand.domain}`;
    },
    get reservationEmail() {
      return `reservations@${siteConstants.brand.domain}`;
    },
    get contactEmail() {
      return `contact@${siteConstants.brand.domain}`;
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
  },
  social: {
    instagram: "https://www.instagram.com/deskohub/",
    facebook: "https://www.facebook.com/profile.php?id=61573597011510",
    youtube: "https://www.youtube.com/@Deskohub",
  },
  pricing: {
    entryFee: {
      withPurchase: 50,
      withoutPurchase: 100,
      childrenUnder15: 0,
    },
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
        minuteIncrement: 30, // Time selection must be in 30-minute increments
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
  },
  workingHours: {
    // All times are in Europe/Prague timezone (CET/CEST)
    timezone: "Europe/Prague",
    weekdays: {
      // Monday to Friday
      days: [1, 2, 3, 4, 5],
      open: "17:00",
      close: "23:00",
      formatted: "17:00 - 23:00",
      formattedNoSpaces: "17:00-23:00",
    },
    weekends: {
      // Saturday and Sunday
      days: [0, 6],
      open: "15:00",
      close: "23:00",
      formatted: "15:00 - 23:00",
      formattedNoSpaces: "11:00-23:00",
    },
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
