import { describe, expect, test } from "bun:test";
import {
  type CustomerAccountState,
  type CustomerBookingQuote,
  CustomerRateLimited,
  CustomerServiceUnavailable,
} from "@deskohub/workspace-customer-api";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { CustomerViewError } from "../../customer-api/customer-view-error";
import {
  BookingCatalogViewError,
  type BookingQueryViewError,
} from "../data/booking-query-error";
import { toOfficeSelection } from "../selection/office-selection";
import {
  type BookingRead,
  bookingReadOf,
  checkoutRequestOf,
  freshValue,
  isRetryableBookingQueryError,
  opensWithoutAccount,
  quotableSelection,
  quoteFailureRepeats,
  restartReasonOf,
} from "./booking-family-view";

const selection = toOfficeSelection({
  date: "2026-11-20",
  dayCount: 2,
  seats: 2,
});
const quote = {
  family: "office",
  advertisedPriceToken: "quote-token",
} as unknown as CustomerBookingQuote;
const pending = { _tag: "AvailabilityPending" };
const taken = { _tag: "DateUnavailable" };

describe("checkoutRequestOf", () => {
  const complete = {
    locale: "cs-CZ" as const,
    selection: Option.some(selection),
    blockers: [],
    quote: Option.some(quote),
  };

  test("hands checkout the selection with its quote token", () => {
    expect(checkoutRequestOf(complete)).toEqual(
      Option.some({
        locale: "cs-CZ",
        selection,
        advertisedPriceToken: "quote-token",
      })
    );
  });

  test("carries early setup only when the family has it", () => {
    expect(
      Option.map(
        checkoutRequestOf({ ...complete, earlySetup: true }),
        (request) => request.earlySetup
      )
    ).toEqual(Option.some(true));
    expect(
      Option.map(
        checkoutRequestOf(complete),
        (request) => "earlySetup" in request
      )
    ).toEqual(Option.some(false));
  });

  const unfinished: ReadonlyArray<
    readonly [string, Partial<Parameters<typeof checkoutRequestOf>[0]>]
  > = [
    ["a blocker", { blockers: [pending] }],
    ["no quote", { quote: Option.none() }],
    ["an incomplete selection", { selection: Option.none() }],
    [
      "a quote of another family",
      { quote: Option.some({ ...quote, family: "cowork" as const }) },
    ],
  ];

  test.each(unfinished)("continues nowhere with %s", (_, change) => {
    expect(checkoutRequestOf({ ...complete, ...change })).toEqual(
      Option.none()
    );
  });
});

describe("quotableSelection", () => {
  test("quotes while only availability is loading", () => {
    expect(quotableSelection(Option.some(selection), [pending])).toEqual(
      Option.some(selection)
    );
  });

  test("spends no quote on a selection known to be unavailable", () => {
    expect(quotableSelection(Option.some(selection), [pending, taken])).toEqual(
      Option.none()
    );
  });
});

describe("restartReasonOf", () => {
  test("reads a restart reason checkout sent back", () => {
    expect(restartReasonOf("hold_expired")).toEqual(
      Option.some("hold_expired")
    );
  });

  test.each([[undefined], ["toString"], ["unknown"], [["hold_expired"]]])(
    "ignores %p",
    (param) => {
      expect(restartReasonOf(param)).toEqual(Option.none());
    }
  );
});

describe("freshValue", () => {
  test("continues only with a quote that isn't being read again", () => {
    expect(freshValue(bookingReadOf(AsyncResult.success(1)))).toEqual(
      Option.some(1)
    );
    expect(
      freshValue(bookingReadOf(AsyncResult.success(1, { waiting: true })))
    ).toEqual(Option.none());
    expect(freshValue(bookingReadOf(AsyncResult.initial()))).toEqual(
      Option.none()
    );
  });
});

describe("bookingReadOf", () => {
  test("loads, then shows the value", () => {
    expect(bookingReadOf(AsyncResult.initial())).toEqual({ kind: "loading" });
    expect(bookingReadOf(AsyncResult.success(1))).toEqual({
      kind: "loaded",
      value: 1,
      refreshing: false,
    });
  });

  test("words a catalog refusal as a failure retrying can't help", () => {
    const read = bookingReadOf(
      AsyncResult.failure(
        Cause.fail({
          _tag: "CustomerOfferingUnavailable",
          family: "office",
        } as never)
      )
    );

    expect(read).toMatchObject({
      kind: "failed",
      error: BookingCatalogViewError.OfferingUnavailable({ family: "office" }),
      value: Option.none(),
    });
    expect(
      read.kind === "failed" && isRetryableBookingQueryError(read.error)
    ).toBe(false);
  });

  test("treats a defect as unexpected, which retrying can help", () => {
    const read = bookingReadOf(AsyncResult.failure(Cause.die("boom")));

    expect(read).toMatchObject({
      kind: "failed",
      error: { _tag: "Unexpected" },
    });
    expect(
      read.kind === "failed" && isRetryableBookingQueryError(read.error)
    ).toBe(true);
  });
});

describe("quoteFailureRepeats", () => {
  const failed = (error: BookingQueryViewError): BookingRead<unknown> => ({
    kind: "failed",
    error,
    value: Option.none(),
    retrying: false,
  });
  const loaded: BookingRead<unknown> = {
    kind: "loaded",
    value: {},
    refreshing: false,
  };
  const rateLimited = failed(CustomerViewError.RateLimited());
  const sentence = (error: BookingQueryViewError) => error._tag;

  test("one rate limit failing both reads repeats the shown failure", () => {
    expect(
      quoteFailureRepeats(
        Option.some(rateLimited),
        [loaded, rateLimited],
        sentence
      )
    ).toBe(true);
  });

  test("a quote failing differently from the shown failure is its own", () => {
    expect(
      quoteFailureRepeats(
        Option.some(failed(CustomerViewError.Unavailable())),
        [rateLimited],
        sentence
      )
    ).toBe(false);
  });

  test("compares with the first failed read, the one the screen shows", () => {
    expect(
      quoteFailureRepeats(
        Option.some(rateLimited),
        [failed(CustomerViewError.Unavailable()), rateLimited],
        sentence
      )
    ).toBe(false);
  });

  test("different failures worded alike repeat, as the screen shows words", () => {
    expect(
      quoteFailureRepeats(
        Option.some(failed(CustomerViewError.Unavailable())),
        [failed(CustomerViewError.Unexpected())],
        () => "same sentence"
      )
    ).toBe(true);
  });

  test("nothing repeats while the supporting reads or the quote succeed", () => {
    expect(
      quoteFailureRepeats(Option.some(rateLimited), [loaded], sentence)
    ).toBe(false);
    expect(
      quoteFailureRepeats(Option.some(loaded), [rateLimited], sentence)
    ).toBe(false);
    expect(quoteFailureRepeats(Option.none(), [rateLimited], sentence)).toBe(
      false
    );
  });
});

describe("opensWithoutAccount", () => {
  const linked = { kind: "linked" } as unknown as CustomerAccountState;

  // Browsing the catalog spends its own budget and the checkout still
  // refuses an account that can't book, so a spent account read budget
  // alone doesn't keep the booking screens closed.
  test("opens the booking screens when the account's first read was rate limited", () => {
    expect(
      opensWithoutAccount(
        AsyncResult.failure(Cause.fail(new CustomerRateLimited()))
      )
    ).toBe(true);
  });

  test("keeps them behind the account's own states otherwise", () => {
    expect(opensWithoutAccount(AsyncResult.initial())).toBe(false);
    expect(opensWithoutAccount(AsyncResult.success(linked))).toBe(false);
    expect(
      opensWithoutAccount(
        AsyncResult.failure(Cause.fail(new CustomerServiceUnavailable()))
      )
    ).toBe(false);
    expect(
      opensWithoutAccount(
        AsyncResult.failure(Cause.fail(new CustomerRateLimited()), {
          previousSuccess: Option.some(AsyncResult.success(linked)),
        })
      )
    ).toBe(false);
  });
});
