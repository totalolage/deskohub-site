import "server-only";

import {
  type CustomerBookingOfferings,
  type CustomerBookingQuote,
  CustomerBookingSelectionInvalid,
  type CustomerBookingSelectionQuery,
  type CustomerOffering,
  customerAvailabilityReplacementHeader,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer, Match, Option, Schema, Struct } from "effect";
import type { HttpApiBuilder } from "effect/unstable/httpapi";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { loadPublicOfferings } from "@/features/checkout/backend/checkout/public-offerings";
import {
  getPublicOpeningHours,
  type PublicOffering,
} from "@/features/checkout/public-offerings";
import { getReservationQuoteDiscount } from "@/features/checkout/reservation-quote-schema";
import type { Locale } from "@/features/i18n";
import { getPaymentSubmitLegalDocuments } from "@/features/legal/payment-submit-evidence";
import {
  loadAvailability,
  loadMeetingRoomStartTimes,
} from "@/features/reservation/backend/workspace-availability-loader";
import {
  type BookingSelectionInput,
  BookingSelectionRejected,
  resolveBookingQuoteSelection,
} from "@/features/reservation/backend/booking-selection";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import {
  parseMeetingRoomStartTimesQuery,
  parseWorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { currentInstant, plainDateStringSchema } from "@/shared/utils/temporal";
import { CustomerBookingCatalogLayers } from "./customer-booking-catalog-layers";
import type { CustomerBookingEndpoint } from "./customer-booking-endpoint";
import { answerSessionApiFailure } from "./customer-api-failure";
import { answerBookingSelectionFailure } from "./customer-booking-selection-failure";

/** The booking catalog's endpoints, which a booking reads before checkout. */
export type CustomerBookingCatalogEndpointName =
  | "listOfferings"
  | "getAvailability"
  | "getMeetingRoomStartTimes"
  | "getQuote"
  | "listLegalDocuments";

/**
 * Attaches the booking catalog's handlers. Each endpoint builds its read's
 * Layers per request from `CustomerBookingCatalogLayers` and answers a read
 * that fails as unavailable; offerings and availability read the same
 * shared snapshots the booking pages read.
 */
export const handleCustomerBookingCatalog = <R>(
  handlers: HttpApiBuilder.Handlers<
    R,
    CustomerBookingEndpoint<CustomerBookingCatalogEndpointName>
  >
) =>
  Effect.gen(function* () {
    const { pricing, inventory, availability, sealedStateKeys, releases } =
      yield* CustomerBookingCatalogLayers;

    /** What the offerings read: anonymous prices and the office capacity. */
    const offerings = Layer.mergeAll(
      pricing.pipe(Layer.provideMerge(releases.referral)),
      inventory,
      releases.office
    );

    /**
     * What a quote reads beyond the offerings: the keys that seal it for the
     * checkout it starts.
     */
    const quoting = Layer.mergeAll(offerings, sealedStateKeys);

    return handlers
      .handle("listOfferings", ({ query: { locale } }) =>
        loadPublicOfferings(locale).pipe(
          Effect.map(
            (listing): CustomerBookingOfferings => ({
              advertisedOn: listing.advertisedOn.toString(),
              openingHours: getPublicOpeningHours(locale),
              offerings: listing.offerings.map(toCustomerOffering),
            })
          ),
          Effect.provide(offerings),
          answerSessionApiFailure("customerApi.listOfferings")
        )
      )
      .handle("getAvailability", ({ query, headers }) =>
        parseAvailabilityQuery(
          parseWorkspaceAvailabilityQuery,
          new URLSearchParams(definedEntries(query))
        ).pipe(
          Effect.flatMap((parsed) =>
            loadAvailability({
              query: parsed,
              replacementToken: headers[customerAvailabilityReplacementHeader],
            }).pipe(
              Effect.provide(availability),
              answerSessionApiFailure("customerApi.getAvailability")
            )
          )
        )
      )
      .handle("getMeetingRoomStartTimes", ({ query, headers }) =>
        parseAvailabilityQuery(
          parseMeetingRoomStartTimesQuery,
          new URLSearchParams({
            kind: "meeting-room",
            mode: "start-times",
            ...query,
          })
        ).pipe(
          Effect.flatMap((parsed) =>
            loadMeetingRoomStartTimes({
              query: parsed,
              replacementToken: headers[customerAvailabilityReplacementHeader],
            }).pipe(
              Effect.provide(availability),
              answerSessionApiFailure("customerApi.getMeetingRoomStartTimes")
            )
          )
        )
      )
      .handle("getQuote", ({ query }) =>
        quoteSelection(query).pipe(
          Effect.provide(quoting),
          answerBookingSelectionFailure("customerApi.getQuote")
        )
      )
      .handle("listLegalDocuments", ({ query: { locale } }) =>
        Effect.succeed({ documents: getPaymentSubmitLegalDocuments(locale) })
      );
  });

type QuoteQuery = typeof CustomerBookingSelectionQuery.Type & {
  readonly locale: Locale;
};

/**
 * Prices a selection the way the agent tools' `get_quote` does: resolved as
 * the booking pages accept it, then advertised anonymously, with the signed
 * quote a checkout starts from.
 */
const quoteSelection = Effect.fn("customerApi.quoteSelection")(function* (
  query: QuoteQuery
) {
  const now = yield* currentInstant;
  const selection = yield* resolveBookingQuoteSelection({
    selection: yield* toBookingSelectionInput(query),
    locale: query.locale,
    now,
  });
  const advertised = yield* buildAdvertisedPrice(selection.request);
  const { payment } = advertised.quote;

  return {
    family: advertised.kind,
    total: payment.expectedPrice,
    regularPrice: payment.undiscountedPrice,
    discount: getReservationQuoteDiscount(payment),
    quotedAt: now.toString(),
    summary: advertised.summary,
    advertisedPriceToken: advertised.advertisedPriceToken,
  } satisfies CustomerBookingQuote;
});

const decodePlainDate = Schema.decodeUnknownOption(plainDateStringSchema);

/** The contract's dates as calendar dates, and its coffee flag. */
const toBookingSelectionInput = ({
  locale: _locale,
  date,
  endDate,
  coffee,
  ...selection
}: QuoteQuery) =>
  Effect.gen(function* () {
    const plainDate = (field: "date" | "endDate", value: string) =>
      Option.match(decodePlainDate(value), {
        onNone: () =>
          Effect.fail(
            new BookingSelectionRejected({
              reason: { kind: "invalid-field", field },
            })
          ),
        onSome: Effect.succeed,
      });

    return {
      ...selection,
      date: yield* plainDate("date", date),
      ...(endDate !== undefined && {
        endDate: yield* plainDate("endDate", endDate),
      }),
      ...(coffee !== undefined && { coffee: coffee === "true" }),
    } satisfies BookingSelectionInput;
  });

/**
 * Reads the query the way the availability route does, so both accept the
 * same combinations. The contract already checked each value's format; what
 * the route's parser still refuses, such as a meeting-room interval no
 * booking spans, is invalid.
 */
const parseAvailabilityQuery = <Query>(
  parse: (searchParams: URLSearchParams) => Option.Option<Query>,
  searchParams: URLSearchParams
): Effect.Effect<Query, CustomerBookingSelectionInvalid> =>
  Option.match(parse(searchParams), {
    onNone: () => Effect.fail(new CustomerBookingSelectionInvalid({})),
    onSome: Effect.succeed,
  });

const definedEntries = (
  query: Readonly<Record<string, string | number | undefined>>
) =>
  Object.entries(query).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, String(value)]]
  );

const toCustomerOffering = (offering: PublicOffering): CustomerOffering => {
  const copy = Struct.pick(offering, ["name", "description", "usage"]);
  const advertisedPrice = offering.advertisedPrice;

  return Match.value(offering).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork): CustomerOffering => ({
        family: "cowork",
        tier: cowork.tier,
        ...copy,
        price: cowork.price,
        advertisedPrice,
        addOns: cowork.addOns,
      }),
      "meeting-room": (meetingRoom): CustomerOffering => ({
        family: "meeting-room",
        duration: getMeetingRoomReservationDurationKey(meetingRoom.duration),
        durationLabel: meetingRoom.durationLabel,
        ...copy,
        price: meetingRoom.price,
        advertisedPrice,
      }),
      office: (office): CustomerOffering => ({
        family: "office",
        ...copy,
        price: office.price,
        seatPrice: office.seatPrice,
        ...(office.maximumSeats !== undefined && {
          maximumSeats: office.maximumSeats,
        }),
        maximumDurationHours: office.maximumDurationHours,
        advertisedPrice,
      }),
    })
  );
};
