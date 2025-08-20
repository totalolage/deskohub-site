export const PATHNAME_HEADER = "x-pathname";

export const siteConstants = {
  contact: {
    phone: "+420777060478",
    phoneTraining: "+420608200377",
    email: "info@deskohub.cz",
    address: {
      street: "Turnovská 10/430",
      city: "Prague", // English name, will be translated
      cityDistrict: "8",
      postalCode: "180 00",
      countryCode: "CZ",
    },
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
  booking: {
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
};
