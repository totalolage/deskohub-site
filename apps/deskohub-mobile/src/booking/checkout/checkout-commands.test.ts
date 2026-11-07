import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  CustomerAccountLinkRequired,
  type CustomerCheckout,
  CustomerQuoteExpired,
  type ReferralCode,
} from "@deskohub/workspace-customer-api";
import { Effect, Option } from "effect";
import { analytics } from "../../analytics/analytics";
import { accountStorageKey } from "../../customer-api/account-scoped-storage";
import {
  type FakeRequestOutcome,
  fakeWorkspaceOrigin,
} from "../../customer-api/testing/fake-workspace";
import { PaymentBrowserUnavailable } from "../payment-browser.service";
import { RememberedReferralUpdate } from "../remembered-referral";
import { rememberedReferralStorageName } from "../remembered-referral.service";
import { fakeBookingCodes } from "../testing/fake-booking-api";
import {
  type FakeCheckout,
  makeFakeCheckout,
  sampleCheckoutDetails,
  untilCalled,
} from "../testing/fake-checkout";
import { BookingProblem } from "./booking-problem";
import { checkoutReturnTarget, runCheckoutCommand } from "./checkout-commands";
import {
  CheckoutCommand,
  CheckoutEvent,
  type CreateCheckoutCommand,
} from "./checkout-state";

const harnesses: FakeCheckout[] = [];
const harness = async (
  kind?: Parameters<typeof makeFakeCheckout>[0]
): Promise<FakeCheckout> => {
  const created = await makeFakeCheckout(kind);
  harnesses.push(created);
  return created;
};

afterEach(() => {
  for (const created of harnesses.splice(0)) created.dispose();
});

const run = (checkout: FakeCheckout, command: CheckoutCommand) =>
  checkout.inRuntime(runCheckoutCommand(command));

const failed = (operationId: number, problem: BookingProblem) =>
  Option.some(CheckoutEvent.CommandFailed({ operationId, problem }));

const createCommand = (
  checkout: FakeCheckout,
  referralCode: Option.Option<ReferralCode> = Option.none()
): CreateCheckoutCommand => {
  const { locale, selection, advertisedPriceToken } = checkout.request();
  return CheckoutCommand.CreateCheckout({
    operationId: 1,
    request: {
      locale,
      checkoutSessionId: "session-1",
      checkoutAttemptId: "attempt-1",
      selection,
      advertisedPriceToken,
      ...sampleCheckoutDetails,
    },
    referralCode,
  });
};

/** Holds a checkout and returns its answer. */
const hold = async (
  checkout: FakeCheckout,
  referralCode: Option.Option<ReferralCode> = Option.none()
): Promise<CustomerCheckout> => {
  const created = await run(checkout, createCommand(checkout, referralCode));
  const start = Option.getOrThrow(created);
  if (
    start._tag !== "CheckoutCreated" ||
    start.start.status === "payment_disabled"
  ) {
    throw new Error(`No checkout was held: ${start._tag}`);
  }
  return start.start;
};

const submitCommand = (
  checkout: CustomerCheckout,
  referralCode: Option.Option<ReferralCode> = Option.none(),
  legalConsent = true
) =>
  CheckoutCommand.SubmitCheckout({
    operationId: 7,
    request: {
      locale: "en-US",
      payStateToken: checkout.payStateToken,
      legalConsent,
      acceptedLegalDocuments: [
        { key: "terms", hash: "v1" },
        { key: "operating-rules", hash: "v1" },
      ],
    },
    referralCode,
  });

/** The documents the fake currently asks to accept. */
const currentDocuments = async (checkout: FakeCheckout) => {
  const loaded = Option.getOrThrow(
    await run(
      checkout,
      CheckoutCommand.LoadLegalDocuments({ operationId: 2, locale: "en-US" })
    )
  );
  if (loaded._tag !== "LegalDocumentsLoaded") {
    throw new Error(`No documents: ${loaded._tag}`);
  }
  return loaded.documents.map(({ key, hash }) => ({ key, hash }));
};

const submitAccepted = async (
  checkout: FakeCheckout,
  held: CustomerCheckout,
  referralCode: Option.Option<ReferralCode> = Option.none()
) => {
  const command = submitCommand(held, referralCode);
  return CheckoutCommand.SubmitCheckout({
    ...command,
    request: {
      ...command.request,
      acceptedLegalDocuments: await currentDocuments(checkout),
    },
  });
};

describe("CreateCheckout", () => {
  test("holds the selection and sends the remembered referral code", async () => {
    const checkout = await harness();

    const answer = await run(
      checkout,
      createCommand(checkout, Option.some(fakeBookingCodes.referral))
    );

    expect(answer).toMatchObject(
      Option.some({
        _tag: "CheckoutCreated",
        operationId: 1,
        start: { status: "ready", referralApplied: true },
      })
    );
    expect(checkout.booking.calls).toMatchObject([
      { endpoint: "createCheckout", referralCode: fakeBookingCodes.referral },
    ]);
  });

  test("sends no referral header without a remembered code", async () => {
    const checkout = await harness();

    await run(checkout, createCommand(checkout));

    expect(checkout.booking.calls).toMatchObject([
      { endpoint: "createCheckout", referralCode: undefined },
    ]);
  });

  test("answers a review account's hold as created", async () => {
    const checkout = await harness();
    checkout.booking.disablePayment();

    expect(await run(checkout, createCommand(checkout))).toMatchObject(
      Option.some({
        _tag: "CheckoutCreated",
        start: { status: "payment_disabled" },
      })
    );
  });

  test("classifies the checkout's own failures", async () => {
    const checkout = await harness();
    checkout.booking.reject("createCheckout", new CustomerQuoteExpired());
    checkout.booking.reject(
      "createCheckout",
      new CustomerAccountLinkRequired({ reason: "profile-missing" })
    );

    expect(await run(checkout, createCommand(checkout))).toEqual(
      failed(1, BookingProblem.Restart({ reason: "quote_expired" }))
    );
    expect(await run(checkout, createCommand(checkout))).toEqual(
      failed(1, BookingProblem.Blocked({ reason: "profile-missing" }))
    );
  });

  const sharedOutcomes: ReadonlyArray<
    readonly [FakeRequestOutcome, BookingProblem]
  > = [
    [
      "service-unavailable",
      BookingProblem.Retryable({ kind: "service_unavailable" }),
    ],
    ["rate-limited", BookingProblem.Retryable({ kind: "rate_limited" })],
    [
      "session-required",
      BookingProblem.Retryable({ kind: "session_required" }),
    ],
    // Handled, then the connection broke: the hold may exist.
    ["transport-failure", BookingProblem.Unconfirmed()],
    ["unreadable-answer", BookingProblem.Unconfirmed()],
  ];

  for (const [outcome, problem] of sharedOutcomes) {
    test(`maps a ${outcome} answer to ${problem._tag}`, async () => {
      const checkout = await harness();
      checkout.booking.fail("createCheckout", outcome);

      expect(await run(checkout, createCommand(checkout))).toEqual(
        failed(1, problem)
      );
    });
  }

  test("re-checks the session when the API answers 401", async () => {
    const checkout = await harness();
    checkout.booking.fail("createCheckout", "session-required");

    await run(checkout, createCommand(checkout));

    expect(checkout.device.sessionChecks).toBe(1);
  });

  test("a sent create that times out is unconfirmed", async () => {
    const checkout = await harness();
    checkout.booking.fail("createCheckout", "hang");

    const answer = run(checkout, createCommand(checkout));
    await untilCalled(checkout.workspace, "createCheckout");
    await checkout.adjust("15 seconds");

    expect(await answer).toEqual(failed(1, BookingProblem.Unconfirmed()));
  });

  test("committed, response lost: the identical resend gets the same hold", async () => {
    const checkout = await harness();
    const command = createCommand(checkout);
    checkout.booking.fail("createCheckout", "transport-failure");

    const lost = await run(checkout, command);
    // The fake held the order before the connection broke.
    const committed = checkout.booking.attempted("session-1", "attempt-1");
    const resent = await run(checkout, command);

    expect(lost).toEqual(failed(1, BookingProblem.Unconfirmed()));
    expect(committed).toBeDefined();
    const [first, second] = checkout.booking.calls;
    expect(second).toEqual(first);
    expect(resent).toMatchObject(
      Option.some({
        _tag: "CheckoutCreated",
        start: { status: "ready", orderId: committed?.orderId },
      })
    );
  });
});

describe("LoadLegalDocuments", () => {
  test("loads the current documents", async () => {
    const checkout = await harness();

    expect(await currentDocuments(checkout)).not.toHaveLength(0);
  });

  test("a read that fails changed nothing: retry", async () => {
    const checkout = await harness();
    // The client retries a read once after a broken connection.
    checkout.booking.fail("listLegalDocuments", "transport-failure", 2);

    const answer = run(
      checkout,
      CheckoutCommand.LoadLegalDocuments({ operationId: 2, locale: "en-US" })
    );
    await untilCalled(checkout.workspace, "listLegalDocuments");
    // The client's pause before its one retry.
    await checkout.adjust("1 second");

    expect(await answer).toEqual(
      failed(2, BookingProblem.Retryable({ kind: "connection" }))
    );
    expect(checkout.workspace.calls as ReadonlyArray<string>).toEqual([
      "listLegalDocuments",
      "listLegalDocuments",
    ]);
  });

  test("a read that times out changed nothing either", async () => {
    const checkout = await harness();
    checkout.booking.fail("listLegalDocuments", "hang");

    const answer = run(
      checkout,
      CheckoutCommand.LoadLegalDocuments({ operationId: 2, locale: "en-US" })
    );
    await untilCalled(checkout.workspace, "listLegalDocuments");
    await checkout.adjust("15 seconds");

    expect(await answer).toEqual(
      failed(2, BookingProblem.Retryable({ kind: "connection" }))
    );
  });
});

describe("ApplyDiscountCode", () => {
  const applyCommand = (
    held: CustomerCheckout,
    code: string,
    referralCode: Option.Option<ReferralCode> = Option.none()
  ) =>
    CheckoutCommand.ApplyDiscountCode({
      operationId: 3,
      request: {
        locale: "en-US",
        payStateToken: held.payStateToken,
        code,
      },
      referralCode,
    });

  test("applies a code and sends the remembered referral code", async () => {
    const checkout = await harness();
    const held = await hold(checkout);

    const answer = await run(
      checkout,
      applyCommand(
        held,
        fakeBookingCodes.discount,
        Option.some(fakeBookingCodes.referral)
      )
    );

    expect(answer).toMatchObject(
      Option.some({
        _tag: "CodeApplied",
        operationId: 3,
        result: { discountCode: "applied" },
      })
    );
    expect(checkout.booking.calls.at(-1)).toMatchObject({
      endpoint: "applyCheckoutDiscountCode",
      referralCode: fakeBookingCodes.referral,
    });
  });

  test("a rejected code keeps the hold with the replacement token", async () => {
    const checkout = await harness();
    const held = await hold(checkout);

    const answer = await run(
      checkout,
      applyCommand(held, fakeBookingCodes.expiredWithReplacement)
    );

    expect(answer).toMatchObject(
      Option.some({
        _tag: "CommandFailed",
        problem: {
          _tag: "CodeRejected",
          reason: "unavailable",
          replacement: { _tag: "Some" },
        },
      })
    );
  });

  test("a code whose answer was lost is unconfirmed", async () => {
    const checkout = await harness();
    const held = await hold(checkout);
    checkout.booking.fail("applyCheckoutDiscountCode", "transport-failure");

    expect(
      await run(checkout, applyCommand(held, fakeBookingCodes.discount))
    ).toEqual(failed(3, BookingProblem.Unconfirmed()));
  });
});

describe("AcceptPriceChange", () => {
  const acceptCommand = (payStateToken: string) =>
    CheckoutCommand.AcceptPriceChange({
      operationId: 4,
      request: { locale: "en-US", payStateToken },
    });

  test("accepts the changed price", async () => {
    const checkout = await harness();
    checkout.booking.forcePriceReview("createCheckout");
    const held = await hold(checkout);
    expect(held.status).toBe("price_review");

    const answer = await run(checkout, acceptCommand(held.payStateToken));

    expect(answer).toMatchObject(
      Option.some({
        _tag: "PriceAccepted",
        operationId: 4,
        checkout: { status: "ready" },
      })
    );
  });

  test("an unknown checkout starts over", async () => {
    const checkout = await harness();

    expect(await run(checkout, acceptCommand("ps1.unknown"))).toEqual(
      failed(4, BookingProblem.Restart({ reason: "checkout_not_found" }))
    );
  });
});

describe("SubmitCheckout", () => {
  test("submits for payment with the app's return target and referral code", async () => {
    const checkout = await harness();
    const held = await hold(checkout);

    const answer = await run(
      checkout,
      await submitAccepted(
        checkout,
        held,
        Option.some(fakeBookingCodes.referral)
      )
    );

    expect(answer).toMatchObject(
      Option.some({
        _tag: "Submitted",
        operationId: 7,
        submission: {
          status: "payment_required",
          orderId: held.orderId,
          statusUrl: `deskohub://reservations/${held.orderId}?after=payment`,
        },
      })
    );
    expect(checkout.booking.calls.at(-1)).toMatchObject({
      endpoint: "submitCheckout",
      input: { returnTarget: "native-app" },
      referralCode: fakeBookingCodes.referral,
    });
  });

  test("classifies consent and document failures", async () => {
    const checkout = await harness();
    const held = await hold(checkout);

    expect(
      await run(checkout, submitCommand(held, Option.none(), false))
    ).toEqual(failed(7, BookingProblem.ConsentRequired({ consent: "legal" })));

    const accepted = await submitAccepted(checkout, held);
    checkout.booking.changeLegalDocuments();
    expect(await run(checkout, accepted)).toEqual(
      failed(7, BookingProblem.LegalDocumentsChanged())
    );
  });

  test("committed, response lost: the resend shows the order's status", async () => {
    const checkout = await harness();
    const held = await hold(checkout);
    const command = await submitAccepted(checkout, held);
    checkout.booking.fail("submitCheckout", "transport-failure");

    const lost = await run(checkout, command);
    const resent = await run(checkout, command);

    expect(lost).toEqual(failed(7, BookingProblem.Unconfirmed()));
    expect(resent).toEqual(failed(7, BookingProblem.ShowStatus()));
    const submits = checkout.booking.calls.filter(
      ({ endpoint }) => endpoint === "submitCheckout"
    );
    expect(submits).toHaveLength(2);
    expect(submits[1]).toEqual(submits[0]);
  });
});

describe("checkoutReturnTarget", () => {
  test("returns to the native app on Android and iOS, the web app on web", () => {
    expect(checkoutReturnTarget("android")).toBe("native-app");
    expect(checkoutReturnTarget("ios")).toBe("native-app");
    expect(checkoutReturnTarget("web")).toBe("web-app");
  });
});

describe("OpenPayment", () => {
  const openCommand = CheckoutCommand.OpenPayment({
    operationId: 8,
    orderId: "order-1",
    paymentUrl: "https://pay.sample.example/checkout/order-1",
    returnUrl: "deskohub://reservations/order-1?after=payment",
  });

  test("opens the payment page and answers how it ended", async () => {
    const checkout = await harness();
    checkout.browser.answerWith(Effect.succeed("dismissed"));

    expect(await run(checkout, openCommand)).toEqual(
      Option.some(
        CheckoutEvent.PaymentEnded({ operationId: 8, result: "dismissed" })
      )
    );
    expect(checkout.browser.opened).toEqual([
      {
        paymentUrl: openCommand.paymentUrl,
        returnUrl: openCommand.returnUrl,
      },
    ]);
  });

  test("a page that can't open can be retried", async () => {
    const checkout = await harness();
    checkout.browser.answerWith(
      Effect.fail(new PaymentBrowserUnavailable({ cause: "locked" }))
    );

    expect(await run(checkout, openCommand)).toEqual(
      failed(8, BookingProblem.Retryable({ kind: "payment_browser" }))
    );
  });

  test("a fault in the app answers as unexpected, never as a failure", async () => {
    const checkout = await harness();
    checkout.browser.answerWith(Effect.die("broken"));

    expect(await run(checkout, openCommand)).toEqual(
      failed(8, BookingProblem.Retryable({ kind: "unexpected" }))
    );
  });
});

describe("UpdateRememberedReferral", () => {
  test("keeps the code in the account's storage, then forgets it", async () => {
    const checkout = await harness();
    const key = accountStorageKey(rememberedReferralStorageName, {
      apiOrigin: fakeWorkspaceOrigin,
      accountId: checkout.workspace.data.accountId,
    });

    const remembered = await run(
      checkout,
      CheckoutCommand.UpdateRememberedReferral({
        update: RememberedReferralUpdate.Remember({
          code: fakeBookingCodes.referral,
        }),
      })
    );
    const stored = checkout.device.storage.has(key);
    const forgotten = await run(
      checkout,
      CheckoutCommand.UpdateRememberedReferral({
        update: RememberedReferralUpdate.Forget(),
      })
    );

    expect([remembered, forgotten]).toEqual([Option.none(), Option.none()]);
    expect(stored).toBe(true);
    expect(checkout.device.storage.has(key)).toBe(false);
  });
});

describe("TrackBookingSubmitted", () => {
  test("reports the submission with the analytics reservation kind", async () => {
    const checkout = await harness();
    const capture = spyOn(analytics, "capture").mockImplementation(
      () => undefined
    );
    try {
      const answer = await run(
        checkout,
        CheckoutCommand.TrackBookingSubmitted({ family: "meeting-room" })
      );

      expect(answer).toEqual(Option.none());
      expect(capture).toHaveBeenCalledWith({
        name: "booking submitted",
        properties: { reservation_kind: "meeting_room" },
      });
    } finally {
      capture.mockRestore();
    }
  });

  test("a fault while reporting never fails the checkout", async () => {
    const checkout = await harness();
    const capture = spyOn(analytics, "capture").mockImplementation(() => {
      throw new Error("analytics broke");
    });
    try {
      expect(
        await run(
          checkout,
          CheckoutCommand.TrackBookingSubmitted({ family: "office" })
        )
      ).toEqual(Option.none());
    } finally {
      capture.mockRestore();
    }
  });
});
