import { Schema } from "effect";
import { HttpApiEndpoint } from "effect/unstable/httpapi";
import { Money } from "./customer-account-api";
import {
  CustomerBookableCoworkTier,
  CustomerBookingDateOutOfRange,
  CustomerBookingSelectionInvalid,
  CustomerBookingSelectionQuery,
  CustomerMeetingRoomDuration,
  CustomerMonitorOption,
  CustomerOfferingUnavailable,
  CustomerPlainDate,
  CustomerReservationFamily,
} from "./customer-booking-selection";
import { CustomerCheckoutSummary } from "./customer-checkout-summary";
import { CustomerLocale } from "./customer-locale";
import { CustomerCoworkTier } from "./customer-reservations-api";
import { CustomerServiceUnavailable } from "./customer-session";

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

const LocaleQuery = Schema.Struct({ locale: CustomerLocale });

// Offerings

/** The anonymous price a booking page advertises for an offering today. */
export const CustomerAdvertisedPrice = Schema.Struct({
  /** Includes any public sale running now. */
  price: Money,
  /** The sale discount included in `price`; zero without one. */
  discount: Money,
  /** The last Prague day the sale can be booked, while one with an end runs. */
  saleLastDay: Schema.optionalKey(CustomerPlainDate),
}).annotate({ identifier: "CustomerAdvertisedPrice" });
export type CustomerAdvertisedPrice = typeof CustomerAdvertisedPrice.Type;

const offeringCopyFields = {
  name: Schema.String,
  description: Schema.String,
  /** When and how the product can be used. */
  usage: Schema.String,
};

/** An optional or included extra of a cowork offering. */
export const CustomerOfferingAddOn = Schema.Struct({
  id: Schema.Literals(["coffee", "workstation"]),
  name: Schema.String,
  /** Per day; zero when included. */
  price: Money,
  included: Schema.Boolean,
  /** The configurations to choose between, which share one price. */
  options: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ id: CustomerMonitorOption, name: Schema.String })
    )
  ),
}).annotate({ identifier: "CustomerOfferingAddOn" });

/** One bookable product at its regular and its advertised price. */
export const CustomerOffering = Schema.Union([
  Schema.Struct({
    family: Schema.Literal("cowork"),
    tier: CustomerBookableCoworkTier,
    ...offeringCopyFields,
    /** Per Prague calendar day. */
    price: Money,
    advertisedPrice: CustomerAdvertisedPrice,
    addOns: Schema.Array(CustomerOfferingAddOn),
  }),
  Schema.Struct({
    family: Schema.Literal("meeting-room"),
    duration: CustomerMeetingRoomDuration,
    durationLabel: Schema.String,
    ...offeringCopyFields,
    /** Per booking of the duration. */
    price: Money,
    advertisedPrice: CustomerAdvertisedPrice,
  }),
  Schema.Struct({
    family: Schema.Literal("office"),
    ...offeringCopyFields,
    /** Office access per day, before seats. */
    price: Money,
    /** Per reserved seat per day. */
    seatPrice: Money,
    /** Absent while the office capacity can't be read. */
    maximumSeats: Schema.optionalKey(Schema.Int),
    /** Hours one booking may span, measured between Prague midnights. */
    maximumDurationHours: Schema.Int,
    /** One office day with one seat. */
    advertisedPrice: CustomerAdvertisedPrice,
  }),
]).annotate({ identifier: "CustomerOffering" });
export type CustomerOffering = typeof CustomerOffering.Type;

/** Every offering, in catalog order, priced for `advertisedOn`. */
export const CustomerBookingOfferings = Schema.Struct({
  /** The Prague date the advertised prices are for. */
  advertisedOn: CustomerPlainDate,
  /** When the space is open, in the request's language. */
  openingHours: Schema.String,
  offerings: Schema.Array(CustomerOffering),
}).annotate({ identifier: "CustomerBookingOfferings" });
export type CustomerBookingOfferings = typeof CustomerBookingOfferings.Type;

// Availability

/**
 * Availability of the booking a pay state being replaced holds is ignored:
 * the client sends that pay state's token while the customer changes it.
 */
export const customerAvailabilityReplacementHeader =
  "x-deskohub-workspace-replacement";

const AvailabilityReplacementHeaders = Schema.Struct({
  [customerAvailabilityReplacementHeader]: Schema.optionalKey(Schema.String),
});

const reservationTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
).annotate({
  description: "Prague local date-time (YYYY-MM-DDTHH:mm) or ISO 8601 instant.",
});

/**
 * The availability query the booking pages send: a date range, plus the
 * family's selection to check across it. Omitted dates default to the
 * current booking range.
 */
export const CustomerAvailabilityQuery = Schema.Struct({
  /** Defaults to cowork. */
  kind: Schema.optionalKey(CustomerReservationFamily),
  from: Schema.optionalKey(CustomerPlainDate),
  to: Schema.optionalKey(CustomerPlainDate),
  /** Cowork only: the date the tier and monitor answers are for. */
  date: Schema.optionalKey(CustomerPlainDate),
  /** Cowork only. */
  entryTier: Schema.optionalKey(CustomerBookableCoworkTier),
  /** Cowork only. */
  monitorOption: Schema.optionalKey(CustomerMonitorOption),
  /** Meeting room: one booking's interval. Office: the first day. */
  startsAt: Schema.optionalKey(reservationTimestamp),
  /** Meeting room: one booking's interval. Office: the end of the last day. */
  endsAt: Schema.optionalKey(reservationTimestamp),
  /** Office only. */
  seats: Schema.optionalKey(
    Schema.FiniteFromString.pipe(
      Schema.decodeTo(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
    )
  ),
});

/** A Google Calendar limitation the booking pages show for a date. */
export const CustomerAvailabilityNotice = Schema.Struct({
  date: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
  summary: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "CustomerAvailabilityNotice" });

/**
 * Advisory availability: it can be a few minutes old, and checkout checks the
 * booking again.
 */
export const CustomerAvailability = Schema.Struct({
  date: Schema.optionalKey(Schema.String),
  from: Schema.String,
  to: Schema.String,
  unavailableDates: Schema.Array(Schema.String),
  /** Dates a Reserved Desk can be booked only with a monitor workstation. */
  reservedDeskWorkstationRequiredDates: Schema.Array(Schema.String),
  /** Includes tiers no longer offered, which a held booking may carry. */
  unavailableCoworkTiers: Schema.Array(CustomerCoworkTier),
  meetingRoomUnavailable: Schema.Boolean,
  officeUnavailable: Schema.Boolean,
  unavailableMonitorOptions: Schema.Array(CustomerMonitorOption),
  notices: Schema.Array(CustomerAvailabilityNotice),
}).annotate({ identifier: "CustomerAvailability" });
export type CustomerAvailability = typeof CustomerAvailability.Type;

/** Every free meeting-room start on one Prague date for one duration. */
export const CustomerMeetingRoomStartTimes = Schema.Struct({
  date: CustomerPlainDate,
  duration: CustomerMeetingRoomDuration,
  /** In chronological order, each with the interval it books. */
  startTimes: Schema.Array(
    Schema.Struct({
      /** Prague local date-time. */
      startDateTime: Schema.String,
      startsAt: isoInstant,
      endsAt: isoInstant,
      /** Whether a room is also free to come early and set up. */
      earlySetupAvailable: Schema.Boolean,
    })
  ),
}).annotate({ identifier: "CustomerMeetingRoomStartTimes" });
export type CustomerMeetingRoomStartTimes =
  typeof CustomerMeetingRoomStartTimes.Type;

// Quote

/**
 * The anonymous price of one selection, including any public sale running
 * when it was quoted. It doesn't check availability; checkout confirms both.
 */
export const CustomerBookingQuote = Schema.Struct({
  family: CustomerReservationFamily,
  total: Money,
  /** The price without the sale. */
  regularPrice: Money,
  /** What the sale takes off; zero without one. */
  discount: Money,
  quotedAt: isoInstant,
  summary: CustomerCheckoutSummary,
  /**
   * The signed quote a checkout starts from, so checkout can tell the
   * customer when the price changed since they saw it.
   */
  advertisedPriceToken: Schema.String,
}).annotate({ identifier: "CustomerBookingQuote" });
export type CustomerBookingQuote = typeof CustomerBookingQuote.Type;

// Legal documents

/** A published document a customer accepts when they pay, at its current version. */
export const CustomerLegalDocument = Schema.Struct({
  key: Schema.Literals(["terms-and-conditions", "operating-rules"]),
  /** The document's page on the Workspace site. */
  path: Schema.String,
  /** The version the customer accepts; submit sends it back. */
  hash: Schema.String,
  hashAlgorithm: Schema.Literal("sha256"),
}).annotate({ identifier: "CustomerLegalDocument" });
export type CustomerLegalDocument = typeof CustomerLegalDocument.Type;

export const CustomerLegalDocuments = Schema.Struct({
  documents: Schema.Array(CustomerLegalDocument),
}).annotate({ identifier: "CustomerLegalDocuments" });
export type CustomerLegalDocuments = typeof CustomerLegalDocuments.Type;

// Endpoints

/** What a booking reads before checkout: offerings, availability and prices. */
export const customerBookingCatalogEndpoints = [
  HttpApiEndpoint.get("listOfferings", "/offerings", {
    query: LocaleQuery,
    success: CustomerBookingOfferings,
    error: CustomerServiceUnavailable.schema,
  }),
  HttpApiEndpoint.get("getAvailability", "/availability", {
    query: CustomerAvailabilityQuery,
    headers: AvailabilityReplacementHeaders,
    success: CustomerAvailability,
    error: [
      CustomerBookingSelectionInvalid.schema,
      CustomerServiceUnavailable.schema,
    ],
  }),
  HttpApiEndpoint.get(
    "getMeetingRoomStartTimes",
    "/availability/meeting-room-start-times",
    {
      query: Schema.Struct({
        date: CustomerPlainDate,
        duration: CustomerMeetingRoomDuration,
      }),
      headers: AvailabilityReplacementHeaders,
      success: CustomerMeetingRoomStartTimes,
      error: [
        CustomerBookingSelectionInvalid.schema,
        CustomerServiceUnavailable.schema,
      ],
    }
  ),
  HttpApiEndpoint.get("getQuote", "/quote", {
    query: Schema.Struct({
      ...CustomerBookingSelectionQuery.fields,
      locale: CustomerLocale,
    }),
    success: CustomerBookingQuote,
    error: [
      CustomerBookingSelectionInvalid.schema,
      CustomerBookingDateOutOfRange.schema,
      CustomerOfferingUnavailable.schema,
      CustomerServiceUnavailable.schema,
    ],
  }),
  HttpApiEndpoint.get("listLegalDocuments", "/legal-documents", {
    query: LocaleQuery,
    success: CustomerLegalDocuments,
  }),
] as const;
