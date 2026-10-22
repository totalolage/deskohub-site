import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
import { type Locale, m } from "@/features/i18n";
import {
  type WorkspaceReservationKind,
  workspaceReservationKindSchema,
} from "@/features/reservation/reservation-kind";

/** One reservation family's offerings, in catalog order, under its title. */
export type PriceFamily<Offering extends PublicPriceListOffering> = {
  readonly kind: WorkspaceReservationKind;
  readonly title: string;
  readonly offerings: ReadonlyArray<Offering>;
};

/** The offerings grouped by reservation family, leaving out empty ones. */
export const getPriceFamilies = <Offering extends PublicPriceListOffering>(
  offerings: ReadonlyArray<Offering>,
  locale: Locale
): ReadonlyArray<PriceFamily<Offering>> =>
  workspaceReservationKindSchema.literals.flatMap((kind) => {
    const familyOfferings = offerings.filter(
      (offering) => offering.kind === kind
    );

    return familyOfferings.length > 0
      ? [
          {
            kind,
            title: {
              cowork: () => m.pricingCoworkTitle({}, { locale }),
              "meeting-room": () => getWorkspaceMeetingRoomProductTitle(locale),
              office: () => getWorkspaceOfficeProductTitle(locale),
            }[kind](),
            offerings: familyOfferings,
          },
        ]
      : [];
  });

/** The id of a family's price-list heading on the pricing page. */
export const getPriceFamilyHeadingId = (kind: WorkspaceReservationKind) =>
  `pricing-${kind}-title`;

/**
 * The pricing page at a family's price list, without a locale prefix, for
 * links customers receive outside the app.
 */
export const getShareablePriceFamilyPath = (kind: WorkspaceReservationKind) =>
  `/pricing#${getPriceFamilyHeadingId(kind)}`;
