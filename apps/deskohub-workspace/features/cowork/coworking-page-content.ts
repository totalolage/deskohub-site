import { type Locale, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

/** What the coworking page says about each desk, in `locale`. */
export const getCoworkingDesks = (locale: Locale) => {
  const until = workspaceSiteConstants.openingHours.openSpaceUsableUntil;

  return [
    {
      tier: "open-space",
      hours: m.coworkingOpenSpaceHours({ until }, { locale }),
      /** The hour of the day the desk can be used until. */
      usableUntilHour: Number.parseInt(until, 10),
      text: m.coworkingOpenSpaceText({}, { locale }),
      points: [
        m.coworkingOpenSpacePointHours({ until }, { locale }),
        m.coworkingOpenSpacePointInternet({}, { locale }),
        m.coworkingOpenSpacePointCoffee({}, { locale }),
      ],
      cta: m.coworkingOpenSpaceCta({}, { locale }),
    },
    {
      tier: "reserved-desk",
      hours: m.coworkingReservedDeskHours({}, { locale }),
      usableUntilHour: 24,
      text: m.coworkingReservedDeskText({}, { locale }),
      points: [
        m.coworkingReservedDeskPointAccess({}, { locale }),
        m.coworkingReservedDeskPointCoffee({}, { locale }),
        m.coworkingReservedDeskPointWorkstation({}, { locale }),
      ],
      cta: m.coworkingReservedDeskCta({}, { locale }),
    },
  ] as const;
};

/**
 * The coworking space's amenities in `locale`, in page order. The calls
 * text links the meeting room through its `meetingRoom` tag.
 */
export const getCoworkingAmenities = (locale: Locale) =>
  [
    {
      title: m.coworkingAmenityInternetTitle({}, { locale }),
      text: m.coworkingAmenityInternetText({}, { locale }),
    },
    {
      title: m.coworkingAmenityWorkstationTitle({}, { locale }),
      text: m.coworkingAmenityWorkstationText({}, { locale }),
    },
    {
      title: m.coworkingAmenityKitchenTitle({}, { locale }),
      text: m.coworkingAmenityKitchenText({}, { locale }),
    },
    {
      title: m.coworkingAmenityCallsTitle({}, { locale }),
      text: m.coworkingAmenityCallsText({}, { locale }),
    },
    {
      title: m.coworkingAmenityBarTitle({}, { locale }),
      text: m.coworkingAmenityBarText({}, { locale }),
    },
  ] as const;

/** How a coworking day goes, from booking to the door, in `locale`. */
export const getCoworkingSteps = (locale: Locale) =>
  [
    m.coworkingStepBook({}, { locale }),
    m.coworkingStepEmail({}, { locale }),
    m.coworkingStepDoor({}, { locale }),
    m.coworkingStepStay({}, { locale }),
  ] as const;
