import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/meeting-room-product-catalog";
import {
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficeSeatPrice,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  type WorkspaceCoworkCurrentTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
  workspaceProductTierMessages,
} from "@/features/checkout/product-catalog.i18n";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { officeReservationMaximumDurationHours } from "@/features/reservation/office-reservation";
import { joinSentences } from "@/shared/utils/sentences";
import {
  type WorkspaceOpeningHours,
  workspaceSiteConstants,
} from "@/shared/utils/site-constants";
import { plainDateStringSchema } from "@/shared/utils/temporal";

/** An optional or included extra of a cowork offer. */
type PublicOfferingAddOn = {
  readonly id: "coffee" | "workstation";
  readonly name: string;
  /** The price per day; zero when included. */
  readonly price: WorkspaceMoney;
  readonly included: boolean;
  /** The configurations the customer chooses between, which share one price. */
  readonly options?: ReadonlyArray<{
    readonly id: WorkspaceProductMonitorOption;
    readonly name: string;
  }>;
};

type PublicOfferingCopy = {
  readonly name: string;
  readonly description: string;
  /** When and how the product can be used. */
  readonly usage: string;
};

/** One bookable product at its regular catalog price. */
export type PublicCatalogOffering = PublicOfferingCopy &
  (
    | {
        readonly kind: "cowork";
        readonly tier: WorkspaceCoworkCurrentTier;
        /** Per Prague calendar day. */
        readonly price: WorkspaceMoney;
        readonly addOns: ReadonlyArray<PublicOfferingAddOn>;
      }
    | {
        readonly kind: "meeting-room";
        readonly duration: MeetingRoomReservationDuration;
        readonly durationLabel: string;
        /** Per booking of the duration. */
        readonly price: WorkspaceMoney;
      }
    | {
        readonly kind: "office";
        /** Office access per day, before seats. */
        readonly price: WorkspaceMoney;
        /** Per reserved seat per day. */
        readonly seatPrice: WorkspaceMoney;
        /** Absent while the office capacity cannot be read. */
        readonly maximumSeats?: number;
        /** Elapsed hours one booking may span, measured between Prague midnights. */
        readonly maximumDurationHours: number;
      }
  );

/** A catalog offering with the request that prices its smallest booking. */
export type PublicOfferingListing = {
  readonly offering: PublicCatalogOffering;
  /**
   * One day of the cowork tier without paid add-ons, one booking of the
   * meeting-room duration, or one office day with one seat, all starting on
   * the listing date.
   */
  readonly advertisedPriceRequest: AdvertisedPriceRequest;
};

/** The anonymous price a reservation page advertises for a smallest booking. */
type PublicOfferingAdvertisedPrice = {
  /** Includes any public sale running now. */
  readonly price: WorkspaceMoney;
  /** The sale discount included in `price`; zero without one. */
  readonly discount: WorkspaceMoney;
};

/** One bookable product at its regular and its advertised price. */
export type PublicOffering = PublicCatalogOffering & {
  readonly advertisedPrice: PublicOfferingAdvertisedPrice;
};

/**
 * One bookable product on a page that renders without its quote: the
 * advertised price is absent when it could not be quoted.
 */
export type PublicPriceListOffering = PublicCatalogOffering &
  Partial<Pick<PublicOffering, "advertisedPrice">>;

/** The office offer, when office reservations are open. */
export type PublicOfficeOffer = {
  readonly maximumSeats?: number;
};

/** Every product customers can book anonymously, in catalog order. */
export const getPublicCatalogOfferings = ({
  locale,
  office,
}: {
  readonly locale: Locale;
  readonly office?: PublicOfficeOffer;
}): ReadonlyArray<PublicCatalogOffering> => [
  ...workspaceCoworkCurrentTiers.map((tier) => getCoworkOffering(tier, locale)),
  ...workspaceMeetingRoomCatalog.map(({ duration }) =>
    getMeetingRoomOffering(duration, locale)
  ),
  ...(office ? [getOfficeOffering(office, locale)] : []),
];

/**
 * Every product customers can book anonymously, in catalog order, with the
 * request that prices its smallest booking on `date`.
 */
export const getPublicOfferingListings = ({
  date,
  locale,
  office,
}: {
  /** The Prague date the advertised prices are for. */
  readonly date: Temporal.PlainDate;
  readonly locale: Locale;
  readonly office?: PublicOfficeOffer;
}): ReadonlyArray<PublicOfferingListing> => [
  ...workspaceCoworkCurrentTiers.map(
    (tier): PublicOfferingListing => ({
      offering: getCoworkOffering(tier, locale),
      advertisedPriceRequest: {
        locale,
        reservation: getCoworkAdvertisedPriceReservation({
          entryTier: tier,
          coffee: getCoworkTierCoffeeAddon(tier) === "included",
          date: date.toString(),
        }),
      },
    })
  ),
  ...getMeetingRoomDurationAdvertisedPriceRequests({
    locale,
    startDateTime: date.toPlainDateTime().toString({ smallestUnit: "minute" }),
  }).map(
    (advertisedPriceRequest): PublicOfferingListing => ({
      offering: getMeetingRoomOffering(
        advertisedPriceRequest.reservation.details.duration,
        locale
      ),
      advertisedPriceRequest,
    })
  ),
  ...(office
    ? [
        {
          offering: getOfficeOffering(office, locale),
          advertisedPriceRequest: getOfficeAdvertisedPriceRequest({
            locale,
            startsOn: plainDateStringSchema.make(date.toString()),
            endsOn: plainDateStringSchema.make(date.toString()),
            seats: 1,
          }),
        },
      ]
    : []),
];

/** The opening hours shown with the offerings. */
export const getPublicOpeningHours = (
  locale: Locale,
  {
    alwaysOpen,
    openSpaceUsableUntil,
  }: WorkspaceOpeningHours = workspaceSiteConstants.openingHours
) =>
  joinSentences(
    alwaysOpen && m.publicOfferingAlwaysOpen({}, { locale }),
    m.publicOfferingOpenSpaceHours({ until: openSpaceUsableUntil }, { locale })
  );

const getCoworkOffering = (
  tier: WorkspaceCoworkCurrentTier,
  locale: Locale
): PublicCatalogOffering => {
  const coffeeAddon = getCoworkTierCoffeeAddon(tier);

  return {
    kind: "cowork",
    tier,
    name: getWorkspaceProductTierTitle(tier, locale),
    description: workspaceProductTierMessages[tier].description({}, { locale }),
    usage: {
      "open-space": () =>
        m.publicOfferingOpenSpaceUsage(
          { until: workspaceSiteConstants.openingHours.openSpaceUsableUntil },
          { locale }
        ),
      "reserved-desk": () =>
        joinSentences(
          m.publicOfferingReservedDeskUsage({}, { locale }),
          workspaceSiteConstants.openingHours.alwaysOpen &&
            m.publicOfferingReservedDeskAlwaysOpenAccess({}, { locale })
        ),
    }[tier](),
    price: getWorkspaceProductByTier(tier).price,
    addOns: [
      ...(coffeeAddon === "unavailable"
        ? []
        : [
            {
              id: "coffee" as const,
              name: m.reservationCoffeeLabel({}, { locale }),
              price: getWorkspaceProductCoffeeLinePriceForTier(tier),
              included: coffeeAddon === "included",
            },
          ]),
      ...(getCoworkTierWorkstationAddon(tier) === "unavailable"
        ? []
        : [
            {
              id: "workstation" as const,
              name: m.reservationWorkstationLabel({}, { locale }),
              price: workspaceProductWorkstationAddonPrice,
              included: false,
              options: workspaceProductMonitorOptions.map((option) => ({
                id: option,
                name: getWorkspaceProductMonitorTitle(option, locale),
              })),
            },
          ]),
    ],
  };
};

const getMeetingRoomOffering = (
  duration: MeetingRoomReservationDuration,
  locale: Locale
): PublicCatalogOffering => ({
  kind: "meeting-room",
  duration,
  durationLabel: getWorkspaceMeetingRoomDurationLabel(duration, locale),
  name: getWorkspaceMeetingRoomProductTitle(locale),
  description: m.reservationTierMeetingRoomDescription({}, { locale }),
  usage: m.publicOfferingMeetingRoomUsage({}, { locale }),
  price: getWorkspaceMeetingRoomPriceForDuration(duration),
});

const getOfficeOffering = (
  { maximumSeats }: PublicOfficeOffer,
  locale: Locale
): PublicCatalogOffering => ({
  kind: "office",
  name: getWorkspaceOfficeProductTitle(locale),
  description: m.publicOfferingOfficeDescription({}, { locale }),
  usage: m.publicOfferingOfficeUsage(
    { hours: officeReservationMaximumDurationHours },
    { locale }
  ),
  price: getWorkspaceOfficeAccessPrice(1),
  seatPrice: getWorkspaceOfficeSeatPrice(1),
  ...(maximumSeats !== undefined && { maximumSeats }),
  maximumDurationHours: officeReservationMaximumDurationHours,
});
