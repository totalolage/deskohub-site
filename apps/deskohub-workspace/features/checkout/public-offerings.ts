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
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { officeReservationMaximumDurationHours } from "@/features/reservation/office-reservation";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

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

/** The office offer, when office reservations are open. */
type PublicOfficeOffer = {
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
      "reserved-desk": () => m.publicOfferingReservedDeskUsage({}, { locale }),
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
