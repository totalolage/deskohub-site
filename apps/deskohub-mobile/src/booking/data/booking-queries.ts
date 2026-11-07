import type {
  CustomerAvailabilityQuery,
  CustomerBookingSelection,
  CustomerLocale,
  CustomerMeetingRoomDuration,
} from "@deskohub/workspace-customer-api";
import { customerAvailabilityReplacementHeader } from "@deskohub/workspace-customer-api";
import { Duration, Effect, Equal, Hash } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import {
  allowsAutomaticRefresh,
  DotyposReadBudget,
} from "../../customer-api/dotypos-read-budget";

/**
 * What the booking selection and review screens read before checkout, on the
 * account's data runtime. Every read goes through `customerRead`; the
 * `dotyposBacked` flag follows the server's budget class for the endpoint
 * (`customerRequestBudgetClasses.booking` in
 * apps/deskohub-workspace/features/customer-api/customer-request-budget.ts):
 * offerings, availability, meeting-room start times and quotes are
 * `dotypos-read` (the shared table and reservation snapshots read Dotypos on
 * a miss), legal documents are `workspace-only`. Errors stay typed; screens
 * map them with `toBookingQueryError`.
 */

/** Offerings, availability, start times and quotes read Dotypos on a cache miss. */
const catalogRead = customerRead({ dotyposBacked: true });
/** The legal documents' versions are Workspace data. */
const workspaceRead = customerRead({ dotyposBacked: false });

const bookingApi = Effect.map(Effect.service(CustomerApi), (api) => api.booking);

/** Every offering with its advertised price, in the customer's language. */
export const bookingOfferingsAtom = Atom.family((locale: CustomerLocale) =>
  customerDataRuntime.atom(
    Effect.flatMap(bookingApi, (booking) =>
      booking.listOfferings({ query: { locale } })
    ).pipe(catalogRead)
  )
);

/** One availability read: the query, and the pay state a change replaces. */
export interface BookingAvailabilityRequest {
  readonly query: typeof CustomerAvailabilityQuery.Type;
  /**
   * While the customer changes a held booking, its `payStateToken`, so the
   * booking it holds doesn't count against itself.
   */
  readonly replacingPayStateToken?: string;
}

const replacementHeaders = (token: string | undefined) =>
  token === undefined
    ? {}
    : { [customerAvailabilityReplacementHeader]: token };

/**
 * Advisory availability for a query; checkout checks again. Keyed by the
 * request's structure, so equal queries share one read.
 */
export const bookingAvailabilityAtom = Atom.family(
  ({ query, replacingPayStateToken }: BookingAvailabilityRequest) =>
    customerDataRuntime.atom(
      Effect.flatMap(bookingApi, (booking) =>
        booking.getAvailability({
          query,
          headers: replacementHeaders(replacingPayStateToken),
        })
      ).pipe(catalogRead)
    )
);

/** The free meeting-room starts on a Prague date for a duration. */
export interface MeetingRoomStartTimesRequest {
  readonly date: string;
  readonly duration: CustomerMeetingRoomDuration;
  readonly replacingPayStateToken?: string;
}

export const meetingRoomStartTimesAtom = Atom.family(
  ({ date, duration, replacingPayStateToken }: MeetingRoomStartTimesRequest) =>
    customerDataRuntime.atom(
      Effect.flatMap(bookingApi, (booking) =>
        booking.getMeetingRoomStartTimes({
          query: { date, duration },
          headers: replacementHeaders(replacingPayStateToken),
        })
      ).pipe(catalogRead)
    )
);

/**
 * A stable key for a selection: canonical JSON with sorted keys and without
 * absent fields. Temporary; the selection model's own key replaces it.
 */
export const bookingSelectionKey = (selection: CustomerBookingSelection) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(selection)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    )
  );

/** One selection priced in one language; equal when their keys are. */
export class BookingQuoteRequest implements Equal.Equal {
  readonly key: string;

  constructor(
    readonly selection: CustomerBookingSelection,
    readonly locale: CustomerLocale
  ) {
    this.key = bookingSelectionKey(selection);
  }

  [Equal.symbol](that: unknown) {
    return (
      that instanceof BookingQuoteRequest &&
      that.key === this.key &&
      that.locale === this.locale
    );
  }

  [Hash.symbol]() {
    return Hash.string(`${this.locale}\u0000${this.key}`);
  }
}

/**
 * How often a mounted quote is read again, as the site's booking pages do,
 * so its `advertisedPriceToken` stays fresh while the customer decides.
 */
export const quoteRefreshInterval = Duration.minutes(4);

/** The selection as a quote's query string carries it. */
const quoteQuery = (
  { coffee, ...fields }: CustomerBookingSelection,
  locale: CustomerLocale
) => ({
  ...fields,
  ...(coffee === undefined
    ? {}
    : { coffee: coffee ? ("true" as const) : ("false" as const) }),
  locale,
});

/**
 * Schedules the quote's next read in the atom's lifetime: unmounting or a
 * refetch interrupts the wait. A quote spends the Dotypos read budget, so
 * the automatic read is skipped once the budget is down to its reserve.
 */
const refreshQuoteLater = (get: Atom.AtomContext) =>
  Effect.sleep(quoteRefreshInterval).pipe(
    Effect.andThen(
      Effect.when(
        Effect.sync(() => get.refreshSelf()),
        Effect.map(
          Effect.flatMap(
            Effect.service(DotyposReadBudget),
            (budget) => budget.remaining
          ),
          allowsAutomaticRefresh
        )
      )
    ),
    Effect.forkScoped
  );

const quoteFamily = Atom.family(({ selection, locale }: BookingQuoteRequest) =>
  customerDataRuntime.atom((get) =>
    Effect.flatMap(bookingApi, (booking) =>
      booking.getQuote({ query: quoteQuery(selection, locale) })
    ).pipe(catalogRead, Effect.tap(() => refreshQuoteLater(get)))
  )
);

/**
 * The anonymous quote of a complete selection, read again every
 * `quoteRefreshInterval` while mounted.
 */
export const bookingQuoteAtom = (
  selection: CustomerBookingSelection,
  locale: CustomerLocale
) => quoteFamily(new BookingQuoteRequest(selection, locale));

/** The terms and operating rules at their current versions. */
export const legalDocumentsAtom = Atom.family((locale: CustomerLocale) =>
  customerDataRuntime.atom(
    Effect.flatMap(bookingApi, (booking) =>
      booking.listLegalDocuments({ query: { locale } })
    ).pipe(workspaceRead)
  )
);
