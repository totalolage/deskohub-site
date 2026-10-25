import { type Locale, m } from "@/features/i18n";

/** The amenities the home page lists, in page order. */
export const getLandingPageAmenities = (locale: Locale) =>
  [
    {
      id: "internet",
      title: m.landingAmenityInternetTitle({}, { locale }),
      text: m.landingAmenityInternetText({}, { locale }),
    },
    {
      id: "workstation",
      title: m.landingAmenityWorkstationTitle({}, { locale }),
      text: m.landingAmenityWorkstationText({}, { locale }),
    },
    {
      id: "coffee",
      title: m.landingAmenityCoffeeTitle({}, { locale }),
      text: m.landingAmenityCoffeeText({}, { locale }),
    },
    {
      id: "food",
      title: m.landingAmenityFoodTitle({}, { locale }),
      text: m.landingAmenityFoodText({}, { locale }),
    },
    {
      id: "calls",
      title: m.landingAmenityCallsTitle({}, { locale }),
      text: m.landingAmenityCallsText({}, { locale }),
    },
    {
      id: "bar",
      title: m.landingAmenityBarTitle({}, { locale }),
      text: m.landingAmenityBarText({}, { locale }),
    },
  ] as const;
