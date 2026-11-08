import type {
  CustomerCoworkTier,
  CustomerReservationKind,
  CustomerReservationProduct,
  CustomerReservationStatus,
} from "@deskohub/workspace-customer-api";
import { Match } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";

/** The catalog name of a kind of space, as an order's summary names it. */
export const reservationKindTitle = (
  kind: CustomerReservationKind,
  locale: AppLocale
) =>
  ({
    cowork: m.reservations_product_cowork,
    "meeting-room": m.reservations_product_meeting_room,
    office: m.reservations_product_office,
  })[kind]({}, { locale });

const coworkTierTitle = (tier: CustomerCoworkTier, locale: AppLocale) =>
  ({
    basic: m.reservations_product_basic,
    plus: m.reservations_product_plus,
    profi: m.reservations_product_profi,
    "open-space": m.reservations_product_open_space,
    "reserved-desk": m.reservations_product_reserved_desk,
  })[tier]({}, { locale });

/** The catalog name of what a history reservation books (tier for cowork). */
export const reservationProductTitle = (
  product: CustomerReservationProduct,
  locale: AppLocale
) =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ tier }) => coworkTierTitle(tier, locale),
      "meeting-room": () => reservationKindTitle("meeting-room", locale),
      office: () => reservationKindTitle("office", locale),
      other: () => m.reservations_product_other({}, { locale }),
    })
  );

/** A history reservation's status, as the account page words it. */
export const reservationStatusLabel = (
  status: CustomerReservationStatus,
  locale: AppLocale
) =>
  ({
    confirmed: m.reservations_status_confirmed,
    pending: m.reservations_status_pending,
    cancelled: m.reservations_status_cancelled,
    "requires-attention": m.reservations_status_attention,
  })[status]({}, { locale });
