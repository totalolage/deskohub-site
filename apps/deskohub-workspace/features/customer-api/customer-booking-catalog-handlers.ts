import "server-only";

import {
  type CustomerAvailability,
  type CustomerBookingOfferings,
  type CustomerBookingQuote,
  CustomerBookingSelectionInvalid,
  type CustomerBookingSelectionQuery,
  type CustomerOffering,
  customerAvailabilityReplacementHeader,
} from "@deskohub/workspace-customer-api";
import { Data, Effect, Layer, Match, Option, Struct } from "effect";
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
import { resolveBookingQuoteSelection } from "@/features/reservation/backend/booking-selection";
import {
  loadAvailability,
  loadMeetingRoomStartTimes,
} from "@/features/reservation/backend/workspace-availability-loader";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import {
  parseMeetingRoomStartTimesQuery,
  parseWorkspaceAvailabilityQuery,
  type WorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import { providePerRequest } from "@/shared/backend/provide-per-request";
import { currentInstant } from "@/shared/utils/temporal";
import { answerSessionApiFailure } from "./customer-api-failure";
import { CustomerBookingCatalogLayers } from "./customer-booking-catalog-layers";
import type { CustomerBookingEndpoint } from "./customer-booking-endpoint";
import {
  answerBookingSelectionFailure,
  toBookingSelectionInput,
} from "./customer-booking-selection";

/**
 * A public sale source couldn't answer, so the prices may miss a sale. The
 * booking pages still show them; the API answers unavailable instead, so a
 * client retries rather than starting checkout from a price that changes.
 */
class SalePricesUnavailable extends Data.TaggedError("SalePricesUnavailable") {}

/** The booking catalog's endpoints, which a booking reads before checkout. */
export type CustomerBookingCatalogEndpointName =
  | "listOfferings"
  | "getAvailability"
  | "getMeetingRoomStartTimes"
  | "getQuote"
  | "listLegalDocuments";

/**
 * Attaches the booking catalog's handlers. Each endpoint builds its read
 * from `CustomerBookingCatalogLayers` and answers a read that fails as
 * unavailable; offerings and availability read the same shared snapshots
 * the booking pages read. The offerings and the quote read release gates,
 * so they build their Layers per request with `providePerRequest`;
 * availability's Layers keep nothing for a request.
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
          Effect.filterOrFail(
            ({ complete }) => complete,
            () => new SalePricesUnavailable()
          ),
          Effect.map(
            (listing): CustomerBookingOfferings => ({
              advertisedOn: listing.advertisedOn.toString(),
              openingHours: getPublicOpeningHours(locale),
              offerings: listing.offerings.map(toCustomerOffering),
            })
          ),
          providePerRequest(offerings),
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
              Effect.map(toCustomerAvailability),
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
          providePerRequest(quoting),
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
  const { locale: _locale, coffee, ...fields } = query;
  const selection = yield* resolveBookingQuoteSelection({
    selection: yield* toBookingSelectionInput({
      ...fields,
      ...(coffee !== undefined && { coffee: coffee === "true" }),
    }),
    locale: query.locale,
    now,
  });
  const advertised = yield* buildAdvertisedPrice(selection.request);
  if (!advertised.discountsComplete) return yield* new SalePricesUnavailable();
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

/**
 * The availability the booking pages read, without the date a range query
 * names none for or a summary an untitled calendar event lacks: the contract
 * omits both rather than send them empty.
 */
const toCustomerAvailability = ({
  date,
  notices,
  ...availability
}: WorkspaceAvailability): CustomerAvailability => ({
  ...availability,
  ...(date !== undefined && { date }),
  notices: notices.map(({ summary, ...notice }) => ({
    ...notice,
    ...(summary !== undefined && { summary }),
  })),
});

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
