import { Match } from "effect";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import type {
  PublicOfferingAdvertisedPrice,
  PublicPriceListOffering,
} from "@/features/checkout/public-offerings";
import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
import { isMeetingRoomWholeDayReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getShareableReservationStartPath } from "@/features/reservation/routes";
import {
  type Money,
  moneyMajorAmount,
  moneyWithValue,
} from "@/shared/money/money";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  getEveryDayOpeningHours,
  getStructuredDataDocument,
  workspaceBusinessId,
} from "@/shared/utils/structured-data";

/** UN/CEFACT codes Schema.org uses for a unit of time. */
type PriceUnit = { readonly unitCode: "DAY" | "HUR"; readonly value: number };

const day: PriceUnit = { unitCode: "DAY", value: 1 };

const getPrice = (money: Money) => ({
  price: moneyMajorAmount(money),
  priceCurrency: money.currency,
});

const getUnitPriceSpecification = (
  money: Money,
  { unitCode, value }: PriceUnit,
  name?: string
) => ({
  "@type": "UnitPriceSpecification",
  ...(name && { name }),
  ...getPrice(money),
  unitCode,
  referenceQuantity: { "@type": "QuantitativeValue", value, unitCode },
});

/**
 * The offer's price: the advertised one, and while a sale runs, its last
 * bookable day and the regular price struck through beside it, so the sale
 * price never reads as permanent.
 */
const getOfferPrice = ({
  advertisedPrice,
  regularPrice,
  regularPriceSpecification,
  unit,
}: {
  readonly advertisedPrice?: PublicOfferingAdvertisedPrice;
  readonly regularPrice: Money;
  readonly regularPriceSpecification: ReadonlyArray<object>;
  /** The unit of the smallest booking, which the advertised price is for. */
  readonly unit: PriceUnit;
}) => {
  if (!advertisedPrice || advertisedPrice.discount.value <= 0) {
    return {
      ...getPrice(advertisedPrice?.price ?? regularPrice),
      priceSpecification: regularPriceSpecification,
    };
  }

  const { price, discount, saleLastDay } = advertisedPrice;
  return {
    ...getPrice(price),
    ...(saleLastDay && { priceValidUntil: saleLastDay }),
    priceSpecification: [
      getUnitPriceSpecification(price, unit),
      {
        ...getUnitPriceSpecification(
          moneyWithValue(price.value + discount.value, price),
          unit
        ),
        priceType: "https://schema.org/StrikethroughPrice",
      },
    ],
  };
};

const getService = ({
  name,
  offering,
  price,
  addOns = [],
}: {
  readonly name: string;
  readonly offering: PublicPriceListOffering;
  readonly price: ReturnType<typeof getOfferPrice>;
  readonly addOns?: ReadonlyArray<object>;
}) => ({
  "@type": "Service",
  name,
  description: offering.description,
  provider: { "@id": workspaceBusinessId },
  offers: {
    "@type": "Offer",
    url: getOfferingUrl(offering),
    description: offering.usage,
    ...price,
    ...(addOns.length > 0 && { addOn: addOns }),
  },
});

/** The page that books the offering. */
const getOfferingUrl = ({ kind }: PublicPriceListOffering) =>
  getWorkspacePageUrl(getShareableReservationStartPath(kind));

const getOfferingService = (
  offering: PublicPriceListOffering,
  locale: Locale
) =>
  Match.value(offering).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) => ({
        ...getService({
          name: cowork.name,
          offering: cowork,
          price: getOfferPrice({
            advertisedPrice: cowork.advertisedPrice,
            regularPrice: cowork.price,
            regularPriceSpecification: [
              getUnitPriceSpecification(cowork.price, day),
            ],
            unit: day,
          }),
          // Included extras are part of the tier price. Sales never cover
          // extras, so theirs is the regular price.
          addOns: cowork.addOns
            .filter(({ included }) => !included)
            .map((addOn) => ({
              "@type": "Offer",
              name: addOn.name,
              url: getOfferingUrl(cowork),
              ...getPrice(addOn.price),
              priceSpecification: getUnitPriceSpecification(addOn.price, day),
            })),
        }),
        ...(cowork.tier === "open-space" && {
          hoursAvailable: getEveryDayOpeningHours(
            workspaceSiteConstants.openingHours.openSpaceUsableUntil
          ),
        }),
      }),
      "meeting-room": (meetingRoom) => {
        const unit: PriceUnit = isMeetingRoomWholeDayReservationDuration(
          meetingRoom.duration
        )
          ? day
          : { unitCode: "HUR", value: meetingRoom.duration.amount };

        return getService({
          name: getWorkspaceMeetingRoomDurationTitle(
            meetingRoom.duration,
            locale
          ),
          offering: meetingRoom,
          price: getOfferPrice({
            advertisedPrice: meetingRoom.advertisedPrice,
            regularPrice: meetingRoom.price,
            regularPriceSpecification: [
              getUnitPriceSpecification(meetingRoom.price, unit),
            ],
            unit,
          }),
        });
      },
      office: (office) =>
        getService({
          name: office.name,
          offering: office,
          // The advertised price is one day with one seat.
          price: getOfferPrice({
            advertisedPrice: office.advertisedPrice,
            regularPrice: office.price,
            regularPriceSpecification: [
              getUnitPriceSpecification(office.price, day),
              getUnitPriceSpecification(
                office.seatPrice,
                day,
                m.publicOfferingOfficeSeatPrice({}, { locale })
              ),
            ],
            unit: day,
          }),
        }),
    })
  );

/**
 * One Schema.org Service per offering, each with its Offer on the page that
 * books it, provided by the business node the site layout renders.
 */
export const getPublicOfferingsStructuredData = ({
  locale,
  offerings,
}: {
  readonly locale: Locale;
  readonly offerings: ReadonlyArray<PublicPriceListOffering>;
}) =>
  getStructuredDataDocument({
    "@graph": offerings.map((offering) => getOfferingService(offering, locale)),
  });
