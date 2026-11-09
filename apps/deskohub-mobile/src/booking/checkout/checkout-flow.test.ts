import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { CustomerCheckoutDetailsInvalid } from "@deskohub/workspace-customer-api";
import { Clock, Deferred, Effect, Exit, Option } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { reservationHistoryAtom } from "../../account/reservations/reservations-list-state";
import { analytics } from "../../analytics/analytics";
import { accountStorageKey } from "../../customer-api/account-scoped-storage";
import { fakeWorkspaceOrigin } from "../../customer-api/testing/fake-workspace";
import {
  type PaymentBrowserResult,
  PaymentBrowserUnavailable,
} from "../payment-browser.service";
import { RememberedReferralUpdate } from "../remembered-referral";
import {
  RememberedReferralCode,
  rememberedReferralStorageName,
} from "../remembered-referral.service";
import {
  fakeBookingCodes,
  fakeHoldDuration,
} from "../testing/fake-booking-api";
import {
  type FakeCheckout,
  makeFakeCheckout,
  sampleCheckoutDetails,
  waitForValue,
} from "../testing/fake-checkout";
import {
  checkoutController,
  checkoutFlowAtom,
  holdClockInterval,
  type RunningCheckout,
} from "./checkout-flow";
import { CheckoutEvent, type CheckoutState } from "./checkout-state";

const harnesses: FakeCheckout[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const created of harnesses.splice(0)) created.dispose();
});

/**
 * Mounts a flow after `arrange` and returns the screen's handle on it,
 * with the screen in view until the test moves it with `setFocused`.
 */
const startFlow = async (
  arrange: (checkout: FakeCheckout) => Promise<void> = async () => undefined
) => {
  const checkout = await makeFakeCheckout();
  harnesses.push(checkout);
  await arrange(checkout);
  const focus = Atom.make(true);
  const setFocused = (focused: boolean) =>
    checkout.registry.set(focus, focused);
  // What the navigation says right now, ahead of the render.
  let inViewNow = true;
  const setInViewNow = (focused: boolean) => {
    inViewNow = focused;
  };
  const atom = checkoutFlowAtom(checkout.request(), focus, () => inViewNow);
  const unmount = checkout.registry.mount(atom);
  cleanups.push(unmount);
  const controller = () => checkoutController(checkout.registry.get(atom));
  const until = (matches: (flow: RunningCheckout) => boolean) =>
    waitForValue(checkout.registry, atom, matches);
  const untilState = <Tag extends CheckoutState["_tag"]>(tag: Tag) =>
    until(({ state }) => state._tag === tag).then(
      ({ state }) => state as Extract<CheckoutState, { readonly _tag: Tag }>
    );
  return {
    checkout,
    atom,
    unmount,
    controller,
    until,
    untilState,
    setFocused,
    setInViewNow,
  };
};

type Flow = Awaited<ReturnType<typeof startFlow>>;

/** Holds the selection and waits for the review with its documents. */
const toReview = async (flow: Flow) => {
  await flow.untilState("Details");
  flow.controller().continueWith(sampleCheckoutDetails);
  return flow.until(
    ({ state }) => state._tag === "Review" && state.legal._tag === "Loaded"
  );
};

/** Ticks the checkbox and pays. */
const pay = async (flow: Flow) => {
  flow.controller().send(CheckoutEvent.ToggleConsent({ accepted: true }));
  await flow.until(
    ({ state }) => state._tag === "Review" && Option.isSome(state.consent)
  );
  flow.controller().send(CheckoutEvent.Pay());
};

/**
 * Gives the flow a turn, for checks that something did not happen; a check
 * that something did happen waits for it instead.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Mounts the Reservations list's read, as the Reservations tab does, once
 * it has loaded; returns how many times it has read the history so far.
 */
const showReservations = async (checkout: FakeCheckout) => {
  cleanups.push(checkout.registry.mount(reservationHistoryAtom));
  await waitForValue(checkout.registry, reservationHistoryAtom, () => true);
  return () =>
    checkout.workspace.calls.filter((call) => call === "listReservations")
      .length;
};

/**
 * Resolves once the Reservations list has read the history `count` times:
 * each successful read ends in a new value of the list, which re-checks
 * `reads`.
 */
const untilReads = async (
  checkout: FakeCheckout,
  reads: () => number,
  count: number
) => {
  await waitForValue(
    checkout.registry,
    reservationHistoryAtom,
    () => reads() >= count
  );
  expect(reads()).toBe(count);
};

const rememberReferral = (checkout: FakeCheckout) =>
  checkout.inRuntime(
    Effect.flatMap(Effect.service(RememberedReferralCode), (remembered) =>
      remembered.remember(fakeBookingCodes.referral)
    )
  );

const referralKey = (checkout: FakeCheckout) =>
  accountStorageKey(rememberedReferralStorageName, {
    apiOrigin: fakeWorkspaceOrigin,
    accountId: checkout.workspace.data.accountId,
  });

describe("useCheckoutFlow's flow", () => {
  test("starts once the remembered code and the session id are read", async () => {
    expect(checkoutController(AsyncResult.initial()).view).toEqual({
      _tag: "Starting",
    });

    const flow = await startFlow(rememberReferral);
    const running = await flow.until(() => true);

    expect(running.state).toMatchObject({
      _tag: "Details",
      flow: {
        checkoutSessionId: "session-1",
        rememberedReferralCode: Option.some(fakeBookingCodes.referral),
      },
    });
    expect(flow.controller().view).toMatchObject({
      _tag: "Running",
      now: await flow.checkout.inRuntime(Clock.currentTimeMillis),
    });
  });

  test("books and pays: hold, documents, submit, payment page", async () => {
    const capture = spyOn(analytics, "capture").mockImplementation(
      () => undefined
    );
    cleanups.push(() => capture.mockRestore());
    const flow = await startFlow();
    // On web the payment page leaves the app, so the submission is reported
    // before it opens.
    let reportedBeforeOpening = false;
    flow.checkout.browser.answerWith(
      Effect.sync(() => {
        reportedBeforeOpening = capture.mock.calls.length === 1;
        return "returned" as const;
      })
    );

    const review = await toReview(flow);
    await pay(flow);
    const done = await flow.untilState("Done");

    const orderId =
      review.state._tag === "Review" ? review.state.checkout.orderId : "";
    expect(done.orderId).toBe(orderId);
    expect(flow.checkout.booking.endpoints).toEqual([
      "createCheckout",
      "listLegalDocuments",
      "submitCheckout",
    ]);
    expect(flow.checkout.booking.calls[0]).toMatchObject({
      input: {
        checkoutSessionId: "session-1",
        checkoutAttemptId: "attempt-1",
      },
    });
    expect(flow.checkout.browser.opened).toEqual([
      {
        paymentUrl: expect.stringContaining(orderId),
        returnUrl: `deskohub://reservations/${orderId}?after=payment`,
      },
    ]);
    expect(capture).toHaveBeenCalledWith({
      name: "booking submitted",
      properties: { reservation_kind: "cowork" },
    });
    expect(reportedBeforeOpening).toBe(true);
  });

  test("each details submission is a new checkout attempt", async () => {
    const flow = await startFlow();
    flow.checkout.booking.reject(
      "createCheckout",
      new CustomerCheckoutDetailsInvalid({ field: "contact.phone" })
    );
    await flow.untilState("Details");

    flow.controller().continueWith(sampleCheckoutDetails);
    await flow.until(
      ({ state }) => state._tag === "Details" && Option.isSome(state.notice)
    );
    flow.controller().continueWith(sampleCheckoutDetails);
    await flow.untilState("Review");

    expect(
      flow.checkout.booking.calls.flatMap((call) =>
        call.endpoint === "createCheckout" ? [call.input.checkoutAttemptId] : []
      )
    ).toEqual(["attempt-1", "attempt-2"]);
  });

  test("committed, response lost: Retry resends the identical create and settles", async () => {
    const flow = await startFlow();
    flow.checkout.booking.fail("createCheckout", "transport-failure");
    await flow.untilState("Details");

    flow.controller().continueWith(sampleCheckoutDetails);
    await flow.until(
      ({ state }) => state._tag === "Uncertain" && !state.retrying
    );
    const committed = flow.checkout.booking.attempted("session-1", "attempt-1");
    flow.controller().send(CheckoutEvent.Retry());
    const review = await flow.untilState("Review");

    const [first, second] = flow.checkout.booking.calls;
    expect(first?.endpoint).toBe("createCheckout");
    expect(second).toEqual(first);
    expect(committed).toBeDefined();
    expect(review.checkout.orderId).toBe(committed?.orderId ?? "");
  });

  test("committed, response lost: Retry resends the identical submit, which shows the status", async () => {
    const flow = await startFlow();
    flow.checkout.booking.fail("submitCheckout", "transport-failure");

    const review = await toReview(flow);
    await pay(flow);
    await flow.until(
      ({ state }) => state._tag === "Uncertain" && !state.retrying
    );
    flow.controller().send(CheckoutEvent.Retry());
    const done = await flow.untilState("Done");

    const submits = flow.checkout.booking.calls.filter(
      ({ endpoint }) => endpoint === "submitCheckout"
    );
    expect(submits).toHaveLength(2);
    expect(submits[1]).toEqual(submits[0]);
    expect(
      review.state._tag === "Review" && review.state.checkout.orderId
    ).toBe(done.orderId);
    expect(flow.checkout.browser.opened).toEqual([]);
  });

  test("a submit left unsettled at the hold's expiry shows the status", async () => {
    const flow = await startFlow();
    flow.checkout.booking.fail("submitCheckout", "transport-failure");

    const review = await toReview(flow);
    await pay(flow);
    await flow.until(
      ({ state }) => state._tag === "Uncertain" && !state.retrying
    );
    await flow.checkout.adjust(fakeHoldDuration);
    const done = await flow.untilState("Done");

    expect(
      review.state._tag === "Review" && review.state.checkout.orderId
    ).toBe(done.orderId);
  });

  test("sends the remembered code and forgets it once it is used up", async () => {
    const flow = await startFlow(rememberReferral);
    const { checkout } = flow;

    await toReview(flow);
    // Nothing is left to pay, so the submission uses the code up.
    flow
      .controller()
      .send(CheckoutEvent.CodeChanged({ input: fakeBookingCodes.free }));
    flow.controller().send(CheckoutEvent.ApplyCode());
    await flow.until(
      ({ state }) =>
        state._tag === "Review" && state.code.status._tag === "Applied"
    );
    await pay(flow);
    await flow.untilState("Done");
    await checkout.referral.untilApplied(
      RememberedReferralUpdate.$is("Forget")
    );

    expect(
      checkout.booking.calls.map(({ endpoint, referralCode }) => [
        endpoint,
        referralCode,
      ])
    ).toEqual([
      ["createCheckout", fakeBookingCodes.referral],
      ["listLegalDocuments", undefined],
      ["applyCheckoutDiscountCode", fakeBookingCodes.referral],
      ["submitCheckout", fakeBookingCodes.referral],
    ]);
    expect(checkout.browser.opened).toEqual([]);
    expect(checkout.device.storage.has(referralKey(checkout))).toBe(false);
  });

  test("remembers a referral code the customer applies", async () => {
    const flow = await startFlow();

    await toReview(flow);
    flow
      .controller()
      .send(CheckoutEvent.CodeChanged({ input: fakeBookingCodes.referral }));
    flow.controller().send(CheckoutEvent.ApplyCode());
    const applied = await flow.until(
      ({ state }) =>
        state._tag === "Review" && state.code.status._tag === "Applied"
    );
    await flow.checkout.referral.untilApplied(
      RememberedReferralUpdate.$is("Remember")
    );

    expect(applied.state).toMatchObject({
      flow: { rememberedReferralCode: Option.some(fakeBookingCodes.referral) },
    });
    expect(flow.checkout.device.storage.has(referralKey(flow.checkout))).toBe(
      true
    );
  });

  test("the hold clock ticks every second and ends the hold at its expiry", async () => {
    const flow = await startFlow();
    const review = await toReview(flow);
    const startedAt = review.now;

    await flow.checkout.adjust(holdClockInterval);
    const ticked = await flow.until(({ now }) => now > startedAt);
    await flow.checkout.adjust(fakeHoldDuration);
    const ended = await flow.untilState("Restart");

    expect(ticked.now).toBe(startedAt + 1000);
    expect(ended.reason).toBe("hold_expired");
  });

  test("unmounting interrupts the running command; its answer never arrives", async () => {
    const flow = await startFlow();
    const open = Effect.runSync(Deferred.make<void>());
    const gate = Effect.runSync(Deferred.make<void>());
    const ended = Effect.runSync(
      Deferred.make<
        Exit.Exit<PaymentBrowserResult, PaymentBrowserUnavailable>
      >()
    );
    let answered = false;
    flow.checkout.browser.answerWith(
      Deferred.succeed(open, undefined).pipe(
        Effect.andThen(Deferred.await(gate)),
        Effect.tap(() =>
          Effect.sync(() => {
            answered = true;
          })
        ),
        Effect.as("returned" as const),
        Effect.onExit((exit) => Deferred.succeed(ended, exit))
      )
    );

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Paying");
    await Effect.runPromise(Deferred.await(open));
    expect(flow.checkout.browser.opened).toHaveLength(1);
    flow.unmount();
    // The flow's teardown ends the page's command a few turns later.
    const exit = await Effect.runPromise(Deferred.await(ended));
    Effect.runSync(Deferred.succeed(gate, undefined));

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(answered).toBe(false);
  });

  test("out of view, the payment page waits and opens once the screen is back", async () => {
    const flow = await startFlow();
    await flow.untilState("Details");
    flow.setFocused(false);

    // Everything else keeps running out of view: the hold, the documents,
    // the submit.
    await toReview(flow);
    await pay(flow);
    const paying = await flow.untilState("Paying");
    await settle();
    expect(flow.checkout.booking.endpoints).toEqual([
      "createCheckout",
      "listLegalDocuments",
      "submitCheckout",
    ]);
    expect(flow.checkout.browser.opened).toEqual([]);

    flow.setFocused(true);
    const done = await flow.untilState("Done");
    flow.setFocused(false);
    flow.setFocused(true);
    await settle();

    expect(done.orderId).toBe(paying.orderId);
    expect(flow.checkout.browser.opened).toEqual([
      { paymentUrl: paying.paymentUrl, returnUrl: paying.returnUrl },
    ]);
  });

  test("a blur the flow hasn't heard about yet still holds the page", async () => {
    const flow = await startFlow();
    // The submission is reported as its answer lands, before the payment
    // page would open: the screen leaves view right then.
    const reported = Effect.runSync(Deferred.make<void>());
    const capture = spyOn(analytics, "capture").mockImplementation(() => {
      flow.setFocused(false);
      Effect.runSync(Deferred.succeed(reported, undefined));
    });
    cleanups.push(() => capture.mockRestore());

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Paying");
    await Effect.runPromise(Deferred.await(reported));
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(flow.checkout.browser.opened).toEqual([]);

    flow.setFocused(true);
    await flow.untilState("Done");
    expect(flow.checkout.browser.opened).toHaveLength(1);
  });

  test("a blur not yet rendered still holds the page", async () => {
    const flow = await startFlow();
    // The navigation leaves the screen as the submission is reported, before
    // React renders the blur.
    const capture = spyOn(analytics, "capture").mockImplementation(() =>
      flow.setInViewNow(false)
    );
    cleanups.push(() => capture.mockRestore());

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Paying");
    await settle();
    expect(flow.checkout.browser.opened).toEqual([]);

    // The render catches up, then the customer comes back.
    flow.setFocused(false);
    flow.setInViewNow(true);
    flow.setFocused(true);
    await flow.untilState("Done");
    expect(flow.checkout.browser.opened).toHaveLength(1);
  });

  test("a blur the navigation took back before rendering opens the page on the next tick", async () => {
    const flow = await startFlow();
    const capture = spyOn(analytics, "capture").mockImplementation(() =>
      flow.setInViewNow(false)
    );
    cleanups.push(() => capture.mockRestore());

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Paying");
    await settle();
    expect(flow.checkout.browser.opened).toEqual([]);

    // Back in view before React rendered the blur: no refocus arrives.
    flow.setInViewNow(true);
    await flow.checkout.adjust(holdClockInterval);
    await flow.untilState("Done");
    expect(flow.checkout.browser.opened).toHaveLength(1);
  });

  test("a page held out of view never opens once the screen unmounts", async () => {
    const flow = await startFlow();
    await flow.untilState("Details");
    flow.setFocused(false);

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Paying");
    await settle();
    flow.unmount();
    await settle();
    flow.setFocused(true);
    await settle();

    expect(flow.checkout.browser.opened).toEqual([]);
  });

  test("a refocus the screen unmounts right after never opens the page", async () => {
    const flow = await startFlow();
    await flow.untilState("Details");
    flow.setFocused(false);

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Paying");
    await settle();
    flow.setFocused(true);
    flow.unmount();
    await settle();

    expect(flow.checkout.browser.opened).toEqual([]);
  });
});

describe("a finished booking", () => {
  /** Ends the hold-and-pay path one way; the flow then reaches `Done`. */
  const finishes: ReadonlyArray<
    readonly [string, (flow: Flow) => Promise<void>]
  > = [
    ["the payment page returns", (flow) => pay(flow)],
    [
      "the payment page is dismissed",
      async (flow) => {
        flow.checkout.browser.answerWith(Effect.succeed("dismissed"));
        await pay(flow);
      },
    ],
    [
      "nothing is left to pay",
      async (flow) => {
        flow
          .controller()
          .send(CheckoutEvent.CodeChanged({ input: fakeBookingCodes.free }));
        flow.controller().send(CheckoutEvent.ApplyCode());
        await flow.until(
          ({ state }) =>
            state._tag === "Review" && state.code.status._tag === "Applied"
        );
        await pay(flow);
      },
    ],
    [
      "an unsettled submit is retried",
      async (flow) => {
        flow.checkout.booking.fail("submitCheckout", "transport-failure");
        await pay(flow);
        await flow.until(
          ({ state }) => state._tag === "Uncertain" && !state.retrying
        );
        flow.controller().send(CheckoutEvent.Retry());
      },
    ],
    [
      "the hold expires on an unsettled submit",
      async (flow) => {
        flow.checkout.booking.fail("submitCheckout", "transport-failure");
        await pay(flow);
        await flow.until(
          ({ state }) => state._tag === "Uncertain" && !state.retrying
        );
        await flow.checkout.adjust(fakeHoldDuration);
      },
    ],
  ];

  test.each(finishes)(
    "reads the Reservations list again once: %s",
    async (_, finish) => {
      const flow = await startFlow();
      const reads = await showReservations(flow.checkout);
      expect(reads()).toBe(1);

      await toReview(flow);
      expect(reads()).toBe(1);
      await finish(flow);
      await flow.untilState("Done");
      await untilReads(flow.checkout, reads, 2);
      // The clock keeps ticking on the finished flow; nothing reads again.
      await flow.checkout.adjust(holdClockInterval);
      await flow.checkout.adjust(holdClockInterval);
      flow.unmount();
      await settle();

      expect(reads()).toBe(2);
    }
  );

  test.each([
    ["the payment page stays open", Effect.never],
    [
      "the payment page can't open",
      Effect.fail(new PaymentBrowserUnavailable({ cause: "busy" })),
    ],
  ] as const)(
    "left at the payment page, reads the list again once as the screen goes: %s",
    async (_, page) => {
      const flow = await startFlow();
      const reads = await showReservations(flow.checkout);
      flow.checkout.browser.answerWith(page);

      await toReview(flow);
      await pay(flow);
      await flow.untilState("Paying");
      await settle();
      expect(reads()).toBe(1);
      flow.unmount();
      await untilReads(flow.checkout, reads, 2);
      await settle();

      expect(reads()).toBe(2);
    }
  );

  test("with the Reservations list not shown, reads nothing", async () => {
    const flow = await startFlow();

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Done");
    await settle();

    expect(flow.checkout.workspace.calls).not.toContain("listReservations");
  });

  test("a checkout that restarts reads nothing", async () => {
    const flow = await startFlow();
    const reads = await showReservations(flow.checkout);

    await toReview(flow);
    await flow.checkout.adjust(fakeHoldDuration);
    await flow.untilState("Restart");
    await settle();

    expect(reads()).toBe(1);
  });
});
