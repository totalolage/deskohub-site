import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { CustomerCheckoutDetailsInvalid } from "@deskohub/workspace-customer-api";
import { Clock, Deferred, Effect, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { analytics } from "../../analytics/analytics";
import { accountStorageKey } from "../../customer-api/account-scoped-storage";
import { fakeWorkspaceOrigin } from "../../customer-api/testing/fake-workspace";
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
 * Mounts a flow after `arrange` and returns the screen's handle on it.
 */
const startFlow = async (
  arrange: (checkout: FakeCheckout) => Promise<void> = async () => undefined
) => {
  const checkout = await makeFakeCheckout();
  harnesses.push(checkout);
  await arrange(checkout);
  const atom = checkoutFlowAtom(checkout.request());
  const unmount = checkout.registry.mount(atom);
  cleanups.push(unmount);
  const controller = () => checkoutController(checkout.registry.get(atom));
  const until = (matches: (flow: RunningCheckout) => boolean) =>
    waitForValue(checkout.registry, atom, matches);
  const untilState = <Tag extends CheckoutState["_tag"]>(tag: Tag) =>
    until(({ state }) => state._tag === tag).then(
      ({ state }) => state as Extract<CheckoutState, { readonly _tag: Tag }>
    );
  return { checkout, atom, unmount, controller, until, untilState };
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    await settle();

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
    await settle();

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
    const gate = Effect.runSync(Deferred.make<void>());
    let interrupted = false;
    let answered = false;
    flow.checkout.browser.answerWith(
      Deferred.await(gate).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            answered = true;
          })
        ),
        Effect.as("returned" as const),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      )
    );

    await toReview(flow);
    await pay(flow);
    await flow.untilState("Paying");
    expect(flow.checkout.browser.opened).toHaveLength(1);
    flow.unmount();
    await settle();
    Effect.runSync(Deferred.succeed(gate, undefined));
    await settle();

    expect(interrupted).toBe(true);
    expect(answered).toBe(false);
  });
});
