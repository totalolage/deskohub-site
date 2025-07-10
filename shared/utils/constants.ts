export const constants = {
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
      tablePreference: {
        values: ["standard", "large", "private", "any"] as const,
      },
      specialRequests: {
        max: 500,
      },
      duration: {
        min: 0.5, // 30 minutes minimum
        increment: 0.5, // 30 minute increments
      },
    },
    defaultValues: {
      datetime: undefined as Date | undefined,
      guestCount: 2,
      tablePreference: "any" as const,
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
    },
    weekends: {
      // Saturday and Sunday
      days: [0, 6],
      open: "15:00",
      close: "24:00",
    },
  },
};
