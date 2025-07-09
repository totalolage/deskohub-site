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
    },
    defaultValues: {
      guestCount: 2,
      tablePreference: "any" as const,
      specialRequests: "",
      name: "",
      email: "",
      phone: "",
    },
  },
};
