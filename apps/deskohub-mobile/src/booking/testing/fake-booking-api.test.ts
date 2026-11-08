import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type CreateCustomerCheckout,
  type CustomerBookingSelection,
  CustomerCheckoutUnavailable,
  CustomerSelectionUnavailable,
  customerReferralCodeHeader,
} from "@deskohub/workspace-customer-api";
import { Effect } from "effect";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { fakeCustomerApiLayer } from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import {
  type FakeBookingApi,
  fakeBooking,
  fakeBookingCodes,
  fakeHoldDuration,
} from "./fake-booking-api";
import { sampleLegalDocuments } from "./sample-booking-catalog";

const harness = (
  kind: Parameters<typeof FakeWorkspace.forKind>[0] = "linked"
) => {
  const workspace = FakeWorkspace.forKind(kind);
  const booking = fakeBooking(workspace);
  const layer = fakeCustomerApiLayer(workspace);
  const run = <A, E>(
    use: (api: CustomerApi["Service"]["booking"]) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.result(
        Effect.flatMap(Effect.service(CustomerApi), (api) =>
          use(api.booking)
        ).pipe(Effect.provide(layer))
      )
    );
  return { workspace, booking, run };
};

const coworkSelection = (
  booking: FakeBookingApi
): CustomerBookingSelection => ({
  family: "cowork",
  tier: "open-space",
  date: booking.dateIn(20),
  coffee: true,
});

const quoteOf = (
  api: CustomerApi["Service"]["booking"],
  { coffee, ...selection }: CustomerBookingSelection
) =>
  api.getQuote({
    query: {
      ...selection,
      ...(coffee === undefined ? {} : { coffee: coffee ? "true" : "false" }),
      locale: "en-US",
    },
  });

let attempts = 0;
/** Each booking submission is a new checkout attempt. */
const nextAttempt = () => {
  attempts += 1;
  return attempts;
};

const createPayload = (
  selection: CustomerBookingSelection,
  advertisedPriceToken: string
): CreateCustomerCheckout => ({
  locale: "en-US",
  checkoutSessionId: "session-1",
  checkoutAttemptId: `attempt-${nextAttempt()}`,
  advertisedPriceToken,
  selection,
  bookingFor: "self",
  contact: {
    name: "Alex Sample",
    email: testEmailAddress("alex"),
    phone: "+420600000000",
  },
  billing: { purpose: "personal", invoice: "none" },
});

/** Quotes and holds a selection; returns the checkout answer. */
const held = (
  api: CustomerApi["Service"]["booking"],
  selection: CustomerBookingSelection,
  headers: Record<string, string> = {}
) =>
  Effect.flatMap(quoteOf(api, selection), (quote) =>
    api.createCheckout({
      payload: createPayload(selection, quote.advertisedPriceToken),
      headers,
    })
  );

const legalAcceptance = (version = 1) =>
  sampleLegalDocuments("en-US", version).map(({ key, hash }) => ({
    key,
    hash,
  }));

describe("fake booking catalog", () => {
  test("lists cowork tiers, meeting-room durations and the office", async () => {
    const { run } = harness();
    const result = await run((api) =>
      api.listOfferings({ query: { locale: "cs-CZ" } })
    );
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(
      result.success.offerings.map((offering) => {
        if (offering.family === "cowork") return offering.tier;
        if (offering.family === "meeting-room") return offering.duration;
        return offering.family;
      })
    ).toEqual([
      "open-space",
      "reserved-desk",
      "hour:1",
      "hour:4",
      "day:1",
      "office",
    ]);
  });

  test("marks some dates, tiers and monitors unavailable", async () => {
    const { run, booking } = harness();
    const soldOut = booking.dateIn(7);
    const result = await run((api) =>
      api.getAvailability({
        query: { kind: "cowork", date: soldOut },
        headers: {},
      })
    );
    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        unavailableDates: [booking.dateIn(3), booking.dateIn(10)],
        reservedDeskWorkstationRequiredDates: [booking.dateIn(5)],
        unavailableCoworkTiers: ["reserved-desk"],
        unavailableMonitorOptions: ["2x32-4k"],
      },
    });
  });

  test("lists meeting-room starts with and without early setup", async () => {
    const { run, booking } = harness();
    const result = await run((api) =>
      Effect.all([
        api.getMeetingRoomStartTimes({
          query: { date: booking.dateIn(1), duration: "hour:1" },
          headers: {},
        }),
        api.getMeetingRoomStartTimes({
          query: { date: booking.dateIn(3), duration: "hour:1" },
          headers: {},
        }),
      ])
    );
    if (result._tag !== "Success") throw new Error("expected start times");
    const [open, closed] = result.success;
    expect(open.startTimes[0]).toMatchObject({
      startDateTime: `${booking.dateIn(1)}T08:00`,
      earlySetupAvailable: false,
    });
    expect(open.startTimes.some((start) => start.earlySetupAvailable)).toBe(
      true
    );
    expect(closed.startTimes).toEqual([]);
  });

  test("quotes a selection with a signed-looking token", async () => {
    const { run, booking } = harness();
    const result = await run((api) => quoteOf(api, coworkSelection(booking)));
    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        family: "cowork",
        total: { value: 40_000, exponent: 2, currency: "CZK" },
      },
    });
    if (result._tag !== "Success") return;
    expect(result.success.advertisedPriceToken).toMatch(
      /^sq1\.[0-9a-f]{8}\.[0-9a-f]{8}$/
    );
  });

  test("lists the legal documents with sha256 hashes", async () => {
    const { run } = harness();
    const result = await run((api) =>
      api.listLegalDocuments({ query: { locale: "en-US" } })
    );
    if (result._tag !== "Success") throw new Error("expected documents");
    expect(result.success.documents.map((document) => document.key)).toEqual([
      "terms-and-conditions",
      "operating-rules",
    ]);
    for (const document of result.success.documents) {
      expect(document.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("fake booking checkout", () => {
  test("holds a quoted selection for ten minutes", async () => {
    const { run, booking } = harness();
    const now = new Date("2026-11-09T09:00:00Z");
    booking.now = () => now;
    const result = await run((api) => held(api, coworkSelection(booking)));
    if (result._tag !== "Success") throw new Error("expected a checkout");
    const checkout = result.success;
    expect(checkout).toMatchObject({
      status: "ready",
      expiresAt: new Date(now.getTime() + fakeHoldDuration).toISOString(),
      summary: { total: { value: 40_000 } },
    });
    if (checkout.status === "payment_disabled") return;
    expect(checkout.orderId).toStartWith("sample-booking-order-");
    expect(checkout.payStateToken).toMatch(/^ps1\./);
  });

  test("answers a quote token for another selection as expired", async () => {
    const { run, booking } = harness();
    const result = await run((api) =>
      Effect.flatMap(quoteOf(api, coworkSelection(booking)), (quote) =>
        api.createCheckout({
          payload: createPayload(
            { ...coworkSelection(booking), coffee: false },
            quote.advertisedPriceToken
          ),
          headers: {},
        })
      )
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerQuoteExpired" },
    });
  });

  test("submits for payment, or as paid when nothing is left to pay", async () => {
    const { run, booking } = harness();
    const submit = (code?: string) =>
      run((api) =>
        Effect.gen(function* () {
          const checkout = yield* held(api, coworkSelection(booking));
          if (checkout.status === "payment_disabled")
            throw new Error("disabled");
          let token = checkout.payStateToken;
          if (code !== undefined) {
            token = (yield* api.applyCheckoutDiscountCode({
              payload: { locale: "en-US", payStateToken: token, code },
              headers: {},
            })).payStateToken;
          }
          return yield* api.submitCheckout({
            payload: {
              locale: "en-US",
              payStateToken: token,
              legalConsent: true,
              acceptedLegalDocuments: legalAcceptance(),
            },
            headers: {},
          });
        })
      );

    expect(await submit()).toMatchObject({
      _tag: "Success",
      success: {
        status: "payment_required",
        paymentUrl: expect.stringContaining("/checkout/sample-booking-order-"),
        statusUrl: expect.stringContaining("orderId=sample-booking-order-"),
      },
    });
    expect(await submit(fakeBookingCodes.free)).toMatchObject({
      _tag: "Success",
      success: { status: "paid" },
    });
  });

  test("applies the known codes and rejects others", async () => {
    const { run, booking } = harness();
    const apply = (code: string) =>
      run((api) =>
        Effect.flatMap(held(api, coworkSelection(booking)), (checkout) => {
          if (checkout.status === "payment_disabled")
            throw new Error("disabled");
          return api.applyCheckoutDiscountCode({
            payload: {
              locale: "en-US",
              payStateToken: checkout.payStateToken,
              code,
            },
            headers: {},
          });
        })
      );

    expect(await apply(fakeBookingCodes.discount)).toMatchObject({
      success: {
        discountCode: "applied",
        summary: { total: { value: 36_000 } },
      },
    });
    expect(await apply(fakeBookingCodes.referral)).toMatchObject({
      success: {
        discountCode: "referral_accepted",
        referralApplied: true,
        rememberReferralCode: fakeBookingCodes.referral,
      },
    });
    const rejected = await apply("NOPE");
    expect(rejected).toMatchObject({
      failure: { _tag: "CustomerDiscountCodeRejected", reason: "unavailable" },
    });
    expect(
      rejected._tag === "Failure" && "payStateToken" in rejected.failure
    ).toBe(false);
    expect(await apply(fakeBookingCodes.expiredWithReplacement)).toMatchObject({
      failure: {
        _tag: "CustomerDiscountCodeRejected",
        reason: "unavailable",
        payStateToken: expect.stringMatching(/^ps1\./),
        expiresAt: expect.any(String),
      },
    });
  });

  test("records whether the referral header was sent", async () => {
    const { run, booking } = harness();
    await run((api) =>
      held(api, coworkSelection(booking), {
        [customerReferralCodeHeader]: fakeBookingCodes.referral,
      })
    );
    expect(
      booking.calls.map(({ endpoint, referralCode }) => [
        endpoint,
        referralCode,
      ])
    ).toEqual([
      ["getQuote", undefined],
      ["createCheckout", fakeBookingCodes.referral],
    ]);
    const create = booking.calls[1];
    expect(
      create?.endpoint === "createCheckout" && create.input.checkoutAttemptId
    ).toStartWith("attempt-");
  });
});

describe("fake booking pay state", () => {
  const submitWith = (
    api: CustomerApi["Service"]["booking"],
    payStateToken: string
  ) =>
    api.submitCheckout({
      payload: {
        locale: "en-US",
        payStateToken,
        legalConsent: true,
        acceptedLegalDocuments: legalAcceptance(),
      },
      headers: {},
    });

  test("keeps each token's own snapshot after a later step", async () => {
    const { run, booking } = harness();
    booking.forcePriceReview("createCheckout");
    const result = await run((api) =>
      Effect.gen(function* () {
        const review = yield* held(api, coworkSelection(booking));
        if (review.status === "payment_disabled") throw new Error("disabled");
        yield* api.acceptCheckoutPriceChange({
          payload: { locale: "en-US", payStateToken: review.payStateToken },
        });
        return yield* Effect.result(submitWith(api, review.payStateToken));
      })
    );
    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        failure: {
          _tag: "CustomerCheckoutUnavailable",
          reason: "price_review_pending",
        },
      },
    });
  });

  test("answers an identical create retry with the order it made", async () => {
    const { run, booking } = harness();
    const start = Date.parse("2026-11-09T09:00:00Z");
    let now = start;
    booking.now = () => new Date(now);
    booking.fail("createCheckout", "transport-failure");
    const result = await run((api) =>
      Effect.gen(function* () {
        const selection = coworkSelection(booking);
        const quote = yield* quoteOf(api, selection);
        const payload = createPayload(selection, quote.advertisedPriceToken);
        const lost = yield* Effect.result(
          api.createCheckout({ payload, headers: {} })
        );
        now = start + 60_000;
        const retried = yield* api.createCheckout({ payload, headers: {} });
        const next = yield* api.createCheckout({
          payload: { ...payload, checkoutAttemptId: "another-attempt" },
          headers: {},
        });
        return { lost, retried, next };
      })
    );
    if (result._tag !== "Success") throw new Error("expected the creates");
    const { lost, retried, next } = result.success;
    expect(lost).toMatchObject({ failure: { _tag: "HttpClientError" } });
    expect(retried).toMatchObject({
      status: "ready",
      expiresAt: new Date(start + fakeHoldDuration).toISOString(),
    });
    expect(next).toMatchObject({
      expiresAt: new Date(now + fakeHoldDuration).toISOString(),
    });
    expect(next.orderId).not.toBe(retried.orderId);
  });

  test("refuses a code while a price review is pending", async () => {
    const { run, booking } = harness();
    booking.forcePriceReview("createCheckout");
    const result = await run((api) =>
      Effect.flatMap(held(api, coworkSelection(booking)), (checkout) => {
        if (checkout.status === "payment_disabled") throw new Error("disabled");
        return api.applyCheckoutDiscountCode({
          payload: {
            locale: "en-US",
            payStateToken: checkout.payStateToken,
            code: fakeBookingCodes.discount,
          },
          headers: {},
        });
      })
    );
    expect(result).toMatchObject({
      failure: {
        _tag: "CustomerCheckoutUnavailable",
        reason: "price_review_pending",
      },
    });
  });

  test("prices a remembered referral code with its benefit", async () => {
    const { run, booking } = harness();
    const result = await run((api) =>
      held(api, coworkSelection(booking), {
        [customerReferralCodeHeader]: fakeBookingCodes.referral,
      })
    );
    expect(result).toMatchObject({
      success: { referralApplied: true, summary: { total: { value: 36_000 } } },
    });
  });
});

describe("fake booking scripting", () => {
  test("forces a price review on create until the price is accepted", async () => {
    const { run, booking } = harness();
    booking.forcePriceReview("createCheckout", {
      sectionKeys: ["order"],
      itemKeys: ["product:cowork-open-space"],
    });
    const result = await run((api) =>
      Effect.gen(function* () {
        const checkout = yield* held(api, coworkSelection(booking));
        if (checkout.status === "payment_disabled") throw new Error("disabled");
        const submit = (payStateToken: string) =>
          Effect.result(
            api.submitCheckout({
              payload: {
                locale: "en-US",
                payStateToken,
                legalConsent: true,
                acceptedLegalDocuments: legalAcceptance(),
              },
              headers: {},
            })
          );
        const pending = yield* submit(checkout.payStateToken);
        const accepted = yield* api.acceptCheckoutPriceChange({
          payload: { locale: "en-US", payStateToken: checkout.payStateToken },
        });
        const submitted = yield* submit(accepted.payStateToken);
        return { checkout, pending, accepted, submitted };
      })
    );
    if (result._tag !== "Success") throw new Error("expected the flow to run");
    const { checkout, pending, accepted, submitted } = result.success;
    expect(checkout).toMatchObject({
      status: "price_review",
      priceReview: {
        changedKeys: {
          sectionKeys: ["order"],
          itemKeys: ["product:cowork-open-space"],
        },
      },
      summary: { total: { value: 45_000 } },
    });
    expect(pending).toMatchObject({
      failure: {
        _tag: "CustomerCheckoutUnavailable",
        reason: "price_review_pending",
      },
    });
    expect(accepted.status).toBe("ready");
    expect(accepted.priceReview).toBeUndefined();
    expect(accepted.expiresAt).toBe(checkout.expiresAt);
    expect(submitted).toMatchObject({
      success: { status: "payment_required" },
    });
  });

  test("forces a price review on a code without applying it", async () => {
    const { run, booking } = harness();
    booking.forcePriceReview("applyCheckoutDiscountCode");
    const result = await run((api) =>
      Effect.flatMap(held(api, coworkSelection(booking)), (checkout) => {
        if (checkout.status === "payment_disabled") throw new Error("disabled");
        return api.applyCheckoutDiscountCode({
          payload: {
            locale: "en-US",
            payStateToken: checkout.payStateToken,
            code: fakeBookingCodes.discount,
          },
          headers: {},
        });
      })
    );
    expect(result).toMatchObject({ success: { status: "price_review" } });
    if (result._tag !== "Success") return;
    expect(result.success.discountCode).toBeUndefined();
  });

  test("forces errors and payment_disabled once each", async () => {
    const { run, booking } = harness();
    booking.reject(
      "createCheckout",
      new CustomerSelectionUnavailable({ reason: "availability_changed" })
    );
    booking.disablePayment();
    booking.reject(
      "submitCheckout",
      new CustomerCheckoutUnavailable({ reason: "not_payable" })
    );
    const selection = coworkSelection(booking);
    const first = await run((api) => held(api, selection));
    const second = await run((api) => held(api, selection));
    const third = await run((api) =>
      Effect.flatMap(held(api, selection), (checkout) => {
        if (checkout.status === "payment_disabled") throw new Error("disabled");
        return api.submitCheckout({
          payload: {
            locale: "en-US",
            payStateToken: checkout.payStateToken,
            legalConsent: true,
            acceptedLegalDocuments: legalAcceptance(),
          },
          headers: {},
        });
      })
    );
    expect(first).toMatchObject({
      failure: {
        _tag: "CustomerSelectionUnavailable",
        reason: "availability_changed",
      },
    });
    expect(second).toMatchObject({ success: { status: "payment_disabled" } });
    expect(third).toMatchObject({
      failure: { _tag: "CustomerCheckoutUnavailable", reason: "not_payable" },
    });
  });

  test("asks for consent and for the changed legal documents", async () => {
    const { run, booking } = harness();
    const submit = (
      consent: { legalConsent: boolean; earlyPerformanceConsent?: boolean },
      date: string
    ) =>
      run((api) =>
        Effect.flatMap(
          held(api, { ...coworkSelection(booking), date }),
          (checkout) => {
            if (checkout.status === "payment_disabled")
              throw new Error("disabled");
            return api.submitCheckout({
              payload: {
                locale: "en-US",
                payStateToken: checkout.payStateToken,
                ...consent,
                acceptedLegalDocuments: legalAcceptance(),
              },
              headers: {},
            });
          }
        )
      );

    expect(
      await submit({ legalConsent: false }, booking.dateIn(20))
    ).toMatchObject({
      failure: { _tag: "CustomerConsentRequired", consent: "legal" },
    });
    expect(
      await submit({ legalConsent: true }, booking.dateIn(1))
    ).toMatchObject({
      failure: {
        _tag: "CustomerConsentRequired",
        consent: "early_performance",
      },
    });
    expect(
      await submit(
        { legalConsent: true, earlyPerformanceConsent: true },
        booking.dateIn(1)
      )
    ).toMatchObject({ success: { status: "payment_required" } });
    booking.changeLegalDocuments();
    expect(
      await submit({ legalConsent: true }, booking.dateIn(20))
    ).toMatchObject({
      failure: { _tag: "CustomerLegalDocumentsChanged" },
    });
  });

  test("requires a usable account link to hold", async () => {
    const { run, booking } = harness("support-required");
    expect(
      await run((api) => held(api, coworkSelection(booking)))
    ).toMatchObject({
      failure: {
        _tag: "CustomerAccountLinkRequired",
        reason: "support-required",
      },
    });
  });

  test("ends a hold after ten minutes", async () => {
    const { run, booking } = harness();
    const start = Date.parse("2026-11-09T09:00:00Z");
    let now = start;
    booking.now = () => new Date(now);
    const result = await run((api) =>
      Effect.gen(function* () {
        const checkout = yield* held(api, coworkSelection(booking));
        if (checkout.status === "payment_disabled") throw new Error("disabled");
        now = start + fakeHoldDuration;
        return yield* api.acceptCheckoutPriceChange({
          payload: { locale: "en-US", payStateToken: checkout.payStateToken },
        });
      })
    );
    expect(result).toMatchObject({
      failure: { _tag: "CustomerCheckoutUnavailable", reason: "expired" },
    });
  });

  test("breaks the connection after a submit was applied", async () => {
    const { run, booking } = harness();
    booking.fail("submitCheckout", "transport-failure");
    const result = await run((api) =>
      Effect.flatMap(held(api, coworkSelection(booking)), (checkout) => {
        if (checkout.status === "payment_disabled") throw new Error("disabled");
        return Effect.map(
          Effect.result(
            api.submitCheckout({
              payload: {
                locale: "en-US",
                payStateToken: checkout.payStateToken,
                legalConsent: true,
                acceptedLegalDocuments: legalAcceptance(),
              },
              headers: {},
            })
          ),
          (submitted) => ({ orderId: checkout.orderId, submitted })
        );
      })
    );
    if (result._tag !== "Success") throw new Error("expected a checkout");
    expect(result.success.submitted).toMatchObject({
      failure: { _tag: "HttpClientError" },
    });
    expect(booking.checkout(result.success.orderId)?.status).toBe("submitted");
  });
});
