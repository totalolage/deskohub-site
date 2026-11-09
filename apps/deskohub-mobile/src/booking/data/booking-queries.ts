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
  selectionKey,
  withoutAbsentOptions,
} from "../selection/booking-selection";

/**
 * What the booking selection and review screens read before checkout, on the
 * account's data runtime. Every read goes through `customerRead`; the
 * `accountRead` flag follows the server's budget class for the endpoint
 * (`customerRequestBudgetClasses.booking` in
 * apps/deskohub-workspace/features/customer-api/customer-request-budget.ts):
 * offerings, availability, meeting-room start times and quotes are
 * `catalog-read`, with their own per-account budget beside the general one,
 * and legal documents are `workspace-only`. Neither shares the account read
 * budget, so neither spends the app's advisory `AccountReadBudget`. Each
 * catalog read stays cached for its `catalogIdleTTL` after the last screen
 * showing it leaves. Errors stay typed; screens map them with
 * `toBookingQueryError`.
 */

/**
 * How long each catalog read stays cached once no screen shows it, so a
 * customer stepping back to a family, date or duration they just viewed
 * reuses the read instead of spending the account's `catalog-read` budget
 * again. The registry drops the read after this idle time; showing it again
 * within the time keeps it and restarts the time, so this bounds how long a
 * read waits unseen, not how old it gets.
 */
export const catalogIdleTTL = {
  /**
   * Offerings change only when the catalog or its prices are edited, and
   * the price checkout charges comes from the quote, so an offering list a
   * few minutes old costs nothing.
   */
  offerings: Duration.minutes(10),
  /**
   * Availability and meeting-room start times are advisory and may be a few
   * minutes old: checkout checks the selection again. Two minutes covers a
   * customer comparing a few dates or durations, and a date left for longer
   * is read again rather than showing a slot taken meanwhile as free.
   */
  availability: Duration.minutes(2),
  /**
   * A quote carries the `advertisedPriceToken` checkout redeems, so the TTL
   * never serves one older than a mounted quote would be: an idle quote's
   * refresh still falls due at `quoteRefreshInterval` and marks it stale,
   * and a screen coming back to a quote that old reads it again
   * (`quoteFamily`), even one whose refresh failed, so stepping back never
   * redeems a lapsed token into CustomerQuoteExpired. A minute covers
   * stepping back to a selection just priced.
   */
  quote: Duration.minutes(1),
} as const;

/**
 * Offerings, availability, start times and quotes spend the server's
 * `catalog-read` budget, not the account read budget.
 */
const catalogRead = customerRead({ accountRead: false });
/** The legal documents' versions are Workspace data. */
const workspaceRead = customerRead({ accountRead: false });

const bookingApi = Effect.map(
  Effect.service(CustomerApi),
  (api) => api.booking
);

/** Every offering with its advertised price, in the customer's language. */
export const bookingOfferingsAtom = Atom.family((locale: CustomerLocale) =>
  customerDataRuntime
    .atom(
      Effect.flatMap(bookingApi, (booking) =>
        booking.listOfferings({ query: { locale } })
      ).pipe(catalogRead)
    )
    .pipe(Atom.setIdleTTL(catalogIdleTTL.offerings))
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
  token === undefined ? {} : { [customerAvailabilityReplacementHeader]: token };

/**
 * Advisory availability for a query; checkout checks again. Keyed by the
 * request's structure, so equal queries share one read.
 */
export const bookingAvailabilityAtom = Atom.family(
  ({ query, replacingPayStateToken }: BookingAvailabilityRequest) =>
    customerDataRuntime
      .atom(
        Effect.flatMap(bookingApi, (booking) =>
          booking.getAvailability({
            query,
            headers: replacementHeaders(replacingPayStateToken),
          })
        ).pipe(catalogRead)
      )
      .pipe(Atom.setIdleTTL(catalogIdleTTL.availability))
);

/** The free meeting-room starts on a Prague date for a duration. */
export interface MeetingRoomStartTimesRequest {
  readonly date: string;
  readonly duration: CustomerMeetingRoomDuration;
  readonly replacingPayStateToken?: string;
}

export const meetingRoomStartTimesAtom = Atom.family(
  ({ date, duration, replacingPayStateToken }: MeetingRoomStartTimesRequest) =>
    customerDataRuntime
      .atom(
        Effect.flatMap(bookingApi, (booking) =>
          booking.getMeetingRoomStartTimes({
            query: { date, duration },
            headers: replacementHeaders(replacingPayStateToken),
          })
        ).pipe(catalogRead)
      )
      .pipe(Atom.setIdleTTL(catalogIdleTTL.availability))
);

/** One selection priced in one language; equal when their keys are. */
export class BookingQuoteRequest implements Equal.Equal {
  readonly key: string;

  constructor(
    readonly selection: CustomerBookingSelection,
    readonly locale: CustomerLocale
  ) {
    this.key = selectionKey(selection);
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
  selection: CustomerBookingSelection,
  locale: CustomerLocale
) => {
  const { coffee, ...fields } = withoutAbsentOptions(selection);
  return {
    ...fields,
    ...(coffee === undefined
      ? {}
      : { coffee: coffee ? ("true" as const) : ("false" as const) }),
    locale,
  };
};

/**
 * Schedules the quote's next read in the atom's lifetime: dropping the quote
 * or a refetch interrupts the wait. A read that falls due while no screen
 * shows the quote reads nothing and only marks it stale.
 *
 * The read isn't gated on a budget. Quotes spend the general and
 * `catalog-read` budgets (120 per 10 minutes each), which the app doesn't
 * track; one mounted quote reads at most three times in that window. Once
 * the server answers 429 the quote fails as CustomerRateLimited, and a
 * failed read schedules nothing, so automatic reads stop until the quote is
 * read again (a selection change or the screen's retry).
 */
const refreshQuoteLater = (get: Atom.AtomContext) =>
  Effect.sleep(quoteRefreshInterval).pipe(
    Effect.andThen(Effect.sync(() => get.refreshSelf())),
    Effect.forkScoped
  );

const quoteReadFamily = Atom.family(
  ({ selection, locale }: BookingQuoteRequest) =>
    customerDataRuntime
      .atom((get) =>
        Effect.flatMap(bookingApi, (booking) =>
          booking.getQuote({ query: quoteQuery(selection, locale) })
        ).pipe(
          catalogRead,
          Effect.tap(() => refreshQuoteLater(get))
        )
      )
      .pipe(Atom.setIdleTTL(catalogIdleTTL.quote))
);

/**
 * The quote a screen shows: a screen that comes back to a quote read
 * `quoteRefreshInterval` or longer ago reads it again. That covers a quote
 * whose refresh failed, which a mounted screen keeps with its last success,
 * so stepping back never redeems a lapsed token.
 */
const quoteFamily = Atom.family((request: BookingQuoteRequest) =>
  Atom.swr(quoteReadFamily(request), { staleTime: quoteRefreshInterval })
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
