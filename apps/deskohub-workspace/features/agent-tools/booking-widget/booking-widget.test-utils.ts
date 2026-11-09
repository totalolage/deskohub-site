import { type Locale, m } from "@/features/i18n";
import type { CheckAvailabilityResult } from "../check-availability.schema";
import type { GetQuoteResult } from "../get-quote.schema";
import type { AgentOffering } from "../list-offerings.schema";
import type { BookingMode, ShowBookingResult } from "../show-booking.schema";
import type { StartReservationResult } from "../start-reservation.schema";
import type { BookingStart } from "./booking-draft";

const czk = (amount: number) => ({ amount, currency: "CZK" });

const siteOrigin = "https://workspace.deskohub.test";

export const bookingToday = "2099-07-28";

/** Synthetic offerings shaped like `list_offerings`, one per option. */
export const bookingOfferings = (): ReadonlyArray<AgentOffering> => [
  {
    family: "cowork",
    tier: "open-space",
    name: "Open Space",
    description: "A desk in the open space.",
    usage: "Usable until 17:00.",
    price: czk(290),
    price_unit: "day",
    advertised_price: czk(290),
    discount: czk(0),
    add_ons: [],
    reservation_url: `${siteOrigin}/reservation/cowork?entryTier=open-space`,
  },
  {
    family: "cowork",
    tier: "reserved-desk",
    name: "Reserved Desk",
    description: "Your own desk.",
    usage: "The whole day.",
    price: czk(410),
    price_unit: "day",
    advertised_price: czk(369),
    discount: czk(41),
    add_ons: [
      {
        id: "workstation",
        name: "Monitor workstation",
        price: czk(100),
        price_unit: "day",
        included: false,
        options: [
          { id: "2x27-qhd", name: "2× 27″ QHD" },
          { id: "2x32-qhd", name: "2× 32″ QHD" },
        ],
      },
    ],
    reservation_url: `${siteOrigin}/reservation/cowork?entryTier=reserved-desk`,
  },
  ...(
    [
      ["hour:1", "1 hour", 300],
      ["hour:4", "4 hours", 1000],
      ["day:1", "whole day", 2000],
    ] as const
  ).map(
    ([duration, label, amount]): AgentOffering => ({
      family: "meeting-room",
      duration,
      duration_label: label,
      name: "Meeting room",
      description: "A private room.",
      usage: "Starts on the hour.",
      price: czk(amount),
      price_unit: "booking",
      advertised_price: czk(amount),
      discount: czk(0),
      add_ons: [],
      reservation_url: `${siteOrigin}/reservation/meeting-room?duration=${duration}`,
    })
  ),
  {
    family: "office",
    name: "Private office",
    description: "A private office.",
    usage: "Whole days.",
    price: czk(1200),
    price_unit: "day",
    advertised_price: czk(1200),
    discount: czk(0),
    seat_price: czk(150),
    max_seats: 6,
    max_duration_hours: 672,
    add_ons: [],
    reservation_url: `${siteOrigin}/reservation/office`,
  },
];

export const showBookingResult = ({
  mode,
  locale,
  selection = {},
}: {
  readonly mode: BookingMode;
  readonly locale: Locale;
  readonly selection?: ShowBookingResult["selection"];
}): ShowBookingResult => ({
  booking_mode: mode,
  locale,
  selection,
  advertised_on: bookingToday,
  offerings: bookingOfferings(),
  note: m.agentToolBookingViewReservationPageNote({}, { locale }),
});

export const bookingStart = ({
  mode,
  locale,
  selection = {},
  opensLinks = true,
}: {
  readonly mode: BookingMode;
  readonly locale: Locale;
  readonly selection?: ShowBookingResult["selection"];
  readonly opensLinks?: boolean;
}): BookingStart => ({
  locale,
  mode,
  today: bookingToday,
  offerings: bookingOfferings(),
  selection,
  opensLinks,
});

export const availabilityResult = (
  available: boolean,
  locale: Locale = "en-US"
): CheckAvailabilityResult => ({
  family: "cowork",
  available,
  days: [
    {
      date: bookingToday,
      available,
      offers: [
        { tier: "open-space", available, workstation_required: false },
        { tier: "reserved-desk", available, workstation_required: false },
      ],
    },
  ],
  checked_at: "2099-07-28T08:00:00Z",
  note: m.agentToolAvailabilityAdvisoryNote({}, { locale }),
  reservation_url: `${siteOrigin}/reservation/cowork?entryTier=open-space`,
});

/**
 * A free meeting-room start, at `startTime` on the view's first date, whose
 * setup time before it is free or taken.
 */
export const meetingRoomAvailabilityResult = ({
  startTime,
  earlySetupAvailable,
  locale = "en-US",
}: {
  readonly startTime: string;
  readonly earlySetupAvailable: boolean;
  readonly locale?: Locale;
}): CheckAvailabilityResult => ({
  family: "meeting-room",
  available: true,
  days: [{ date: bookingToday, available: true }],
  meeting_room: {
    duration: "hour:1",
    starts_at: `${bookingToday}T${startTime}`,
    ends_at: Temporal.PlainDateTime.from(`${bookingToday}T${startTime}`)
      .add({ hours: 1 })
      .toString({ smallestUnit: "minute" }),
    early_setup_available: earlySetupAvailable,
  },
  checked_at: "2099-07-28T08:00:00Z",
  note: m.agentToolAvailabilityAdvisoryNote({}, { locale }),
  reservation_url: `${siteOrigin}/reservation/meeting-room?startDateTime=${bookingToday}T${startTime}&duration=hour%3A1`,
});

export const quoteResult = (locale: Locale = "en-US"): GetQuoteResult => ({
  family: "cowork",
  total: czk(250),
  regular_price: czk(290),
  discount: czk(40),
  quoted_at: "2099-07-28T08:00:00Z",
  note: m.agentToolQuoteNote({}, { locale }),
  reservation_url: `${siteOrigin}/reservation/cowork?entryTier=open-space&date=${bookingToday}`,
});

export const reservationResult = (
  locale: Locale = "en-US"
): StartReservationResult => ({
  order_id: "order-synthetic-1",
  pay_url: `${siteOrigin}/checkout/pay/order-synthetic-1?state=synthetic`,
  pay_url_expires_at: "2099-07-28T08:10:00Z",
  family: "cowork",
  total: czk(250),
  price_changed: false,
  note: m.agentToolStartReservationNote({}, { locale }),
});
