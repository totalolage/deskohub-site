import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import type { ReservationProductPropertyIds } from "@/features/reservation/reservation-product-descriptor";
import type { AudienceMessage } from "./audience-attribute-wording";

/** How the Admin UI names a product property, and counts a number one. */
type PropertyWording = {
  readonly label: AudienceMessage;
  readonly unit?: AudienceMessage<{ readonly count: number }>;
};

const familyLabels: Readonly<
  Record<WorkspaceReservationKind, AudienceMessage>
> = {
  cowork: m.emailCampaignsAudienceProductFamilyCowork,
  "meeting-room": m.emailCampaignsAudienceProductFamilyMeetingRoom,
  office: m.emailCampaignsAudienceProductFamilyOffice,
};

const propertyWordings: {
  readonly [Family in WorkspaceReservationKind]: {
    readonly [Property in ReservationProductPropertyIds[Family]]: PropertyWording;
  };
} = {
  cowork: {
    tier: { label: m.emailCampaignsAudienceProductPropertyTier },
    coffee: { label: m.emailCampaignsAudienceProductPropertyCoffee },
    monitor: { label: m.emailCampaignsAudienceProductPropertyMonitor },
  },
  "meeting-room": {
    offer: { label: m.emailCampaignsAudienceProductPropertyOffer },
  },
  office: {
    seats: {
      label: m.emailCampaignsAudienceProductPropertySeats,
      unit: m.emailCampaignsAudienceProductUnitSeats,
    },
    days: {
      label: m.emailCampaignsAudienceProductPropertyDays,
      unit: m.emailCampaignsAudienceProductUnitDays,
    },
  },
};

const propertyWording = (
  family: WorkspaceReservationKind,
  property: string
): PropertyWording | undefined =>
  Object.entries(propertyWordings[family]).find(([id]) => id === property)?.[1];

/** A reservation product family as the Admin UI names it ("Meeting room"). */
export const reservationProductFamilyLabel = (
  family: WorkspaceReservationKind,
  locale: Locale
) => familyLabels[family]({}, { locale });

/** A product property's Admin UI label ("Seats"), or its ID if unknown. */
export const reservationProductPropertyLabel = (
  family: WorkspaceReservationKind,
  property: string,
  locale: Locale
) => propertyWording(family, property)?.label({}, { locale }) ?? property;

/**
 * A number property's unit for a count ("3 seats"), or its label when the
 * property has no unit.
 */
export const reservationProductPropertyUnit = (
  family: WorkspaceReservationKind,
  property: string,
  count: number,
  locale: Locale
) =>
  propertyWording(family, property)?.unit?.({ count }, { locale }) ??
  reservationProductPropertyLabel(family, property, locale).toLocaleLowerCase(
    locale
  );
