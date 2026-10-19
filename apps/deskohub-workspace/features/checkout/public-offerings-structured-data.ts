import { Match } from "effect";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import type { PublicCatalogOffering } from "@/features/checkout/public-offerings";
import {
  toWorkspaceMoneyMajorAmount,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { isMeetingRoomWholeDayReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  getEveryDayOpeningHours,
  getStructuredDataDocument,
  workspaceBusinessId,
} from "@/shared/utils/structured-data";

/** UN/CEFACT codes Schema.org uses for a unit of time. */
type PriceUnit = { readonly unitCode: "DAY" | "HUR"; readonly value: number };

const day: PriceUnit = { unitCode: "DAY", value: 1 };

const getPrice = (money: WorkspaceMoney) => ({
  price: toWorkspaceMoneyMajorAmount(money),
  priceCurrency: money.currency,
});

const getUnitPriceSpecification = (
  money: WorkspaceMoney,
  { unitCode, value }: PriceUnit,
  name?: string
) => ({
  "@type": "UnitPriceSpecification",
  ...(name && { name }),
  ...getPrice(money),
  unitCode,
  referenceQuantity: { "@type": "QuantitativeValue", value, unitCode },
});

const getService = ({
  name,
  offering,
  priceSpecification,
  addOns = [],
  url,
}: {
  readonly name: string;
  readonly offering: PublicCatalogOffering;
  readonly priceSpecification: ReadonlyArray<object>;
  readonly addOns?: ReadonlyArray<object>;
  readonly url: string;
}) => ({
  "@type": "Service",
  name,
  description: offering.description,
  provider: { "@id": workspaceBusinessId },
  offers: {
    "@type": "Offer",
    url,
    description: offering.usage,
    ...getPrice(offering.price),
    priceSpecification,
    ...(addOns.length > 0 && { addOn: addOns }),
  },
});

const getOfferingService = (
  offering: PublicCatalogOffering,
  { locale, url }: { readonly locale: Locale; readonly url: string }
) =>
  Match.value(offering).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) => ({
        ...getService({
          name: cowork.name,
          offering: cowork,
          priceSpecification: [getUnitPriceSpecification(cowork.price, day)],
          // Included extras are part of the tier price.
          addOns: cowork.addOns
            .filter(({ included }) => !included)
            .map((addOn) => ({
              "@type": "Offer",
              name: addOn.name,
              url,
              ...getPrice(addOn.price),
              priceSpecification: getUnitPriceSpecification(addOn.price, day),
            })),
          url,
        }),
        ...(cowork.tier === "open-space" && {
          hoursAvailable: getEveryDayOpeningHours(
            workspaceSiteConstants.openingHours.openSpaceUsableUntil
          ),
        }),
      }),
      "meeting-room": (meetingRoom) =>
        getService({
          name: getWorkspaceMeetingRoomDurationTitle(
            meetingRoom.duration,
            locale
          ),
          offering: meetingRoom,
          priceSpecification: [
            getUnitPriceSpecification(
              meetingRoom.price,
              isMeetingRoomWholeDayReservationDuration(meetingRoom.duration)
                ? day
                : { unitCode: "HUR", value: meetingRoom.duration.amount }
            ),
          ],
          url,
        }),
      office: (office) =>
        getService({
          name: office.name,
          offering: office,
          priceSpecification: [
            getUnitPriceSpecification(office.price, day),
            getUnitPriceSpecification(
              office.seatPrice,
              day,
              m.publicOfferingOfficeSeatPrice({}, { locale })
            ),
          ],
          url,
        }),
    })
  );

/**
 * One Schema.org Service per offering, each with its Offer, provided by the
 * business node the site layout renders.
 */
export const getPublicOfferingsStructuredData = ({
  locale,
  offerings,
  url,
}: {
  readonly locale: Locale;
  readonly offerings: ReadonlyArray<PublicCatalogOffering>;
  /** The page that books the offerings. */
  readonly url: string;
}) =>
  getStructuredDataDocument({
    "@graph": offerings.map((offering) =>
      getOfferingService(offering, { locale, url })
    ),
  });
