import { testEmailAddress } from "@deskohub/test-email";
import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import {
  type CustomerDataServices,
  customerDataLayer,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import type { SampleAccountKind } from "../../customer-api/testing/sample-fixtures";
import { sequentialBookingIds } from "../booking-ids.service.mock";
import type { CheckoutRequest } from "../checkout/checkout-flow";
import type { CheckoutDetails } from "../checkout/checkout-state";
import {
  type BookingServices,
  bookingServicesLayer,
} from "../data/booking-services-layer";
import {
  PaymentBrowser,
  type PaymentBrowserResult,
  type PaymentBrowserUnavailable,
} from "../payment-browser.service";
import { observedRememberedReferralCode } from "../remembered-referral.service.mock";
import { fakeBooking } from "./fake-booking-api";

/** The payment page as a test scripts it, recording each page it opened. */
export const makeFakePaymentBrowser = () => {
  const opened: Array<{
    readonly paymentUrl: string;
    readonly returnUrl: string;
  }> = [];
  let answer: Effect.Effect<PaymentBrowserResult, PaymentBrowserUnavailable> =
    Effect.succeed("returned");
  return {
    opened,
    /** What every later page answers. */
    answerWith: (
      next: Effect.Effect<PaymentBrowserResult, PaymentBrowserUnavailable>
    ) => {
      answer = next;
    },
    layer: Layer.succeed(PaymentBrowser, {
      open: (paymentUrl, returnUrl) =>
        Effect.suspend(() => {
          opened.push({ paymentUrl, returnUrl });
          return answer;
        }),
    }),
  };
};

export type FakePaymentBrowser = ReturnType<typeof makeFakePaymentBrowser>;

/** Contact and billing a linked sample account books with. */
export const sampleCheckoutDetails: CheckoutDetails = {
  bookingFor: "self",
  contact: {
    name: "Alex Sample",
    email: testEmailAddress("alex"),
    phone: "+420600000000",
  },
  billing: { purpose: "personal", invoice: "none" },
};

/**
 * One account's data registry for checkout tests: the fake Workspace with
 * its booking group behind the real client, fake device storage under the
 * real account-scoped storage, the real remembered referral code reporting
 * each update it applied, a scripted payment page, numbered ids, and a test
 * clock that starts at the fake's (frozen) clock.
 */
export const makeFakeCheckout = async (kind: SampleAccountKind = "linked") => {
  const workspace = FakeWorkspace.forKind(kind);
  const booking = fakeBooking(workspace);
  const device = makeFakeDevice();
  const browser = makeFakePaymentBrowser();
  const referral = observedRememberedReferralCode();
  const bookingLayer: Layer.Layer<
    BookingServices,
    never,
    CustomerDataServices
  > = Layer.mergeAll(browser.layer, referral.layer, sequentialBookingIds());
  const registry = AtomRegistry.make({
    initialValues: [
      Atom.initialValue(
        customerDataLayer,
        Layer.merge(
          fakeCustomerDataLayer({ workspace, device }),
          TestClock.layer()
        )
      ),
      Atom.initialValue(bookingServicesLayer, bookingLayer),
    ],
  });
  const keepRuntime = registry.mount(customerDataRuntime);

  /** Runs `effect` on the account's runtime with the booking services. */
  const inRuntime = <A, E>(
    effect: Effect.Effect<A, E, CustomerDataServices | BookingServices>
  ) =>
    Effect.runPromise(
      Effect.provideContext(
        effect.pipe(Effect.provide(bookingLayer)),
        AsyncResult.getOrThrow(registry.get(customerDataRuntime))
      )
    );

  // The fake's clock stays where the test clock starts, so holds expire
  // exactly when the test moves the clock past them; a test moves
  // `booking.now` itself to end a hold on the server.
  const startedAt = booking.now();
  booking.now = () => startedAt;
  await inRuntime(TestClock.setTime(startedAt.getTime()));

  /** A cowork selection the fake can hold, with a fresh quote token. */
  const request = (
    selection: CustomerBookingSelection = {
      family: "cowork",
      tier: "open-space",
      date: booking.dateIn(20),
      coffee: true,
    }
  ): CheckoutRequest => ({
    locale: "en-US",
    selection,
    advertisedPriceToken: booking.issueQuoteToken(selection),
  });

  return {
    registry,
    workspace,
    booking,
    device,
    browser,
    referral,
    request,
    inRuntime,
    /** Moves the test clock (the flow's hold clock and request timeouts). */
    adjust: (duration: Parameters<typeof TestClock.adjust>[0]) =>
      inRuntime(TestClock.adjust(duration)),
    dispose: () => {
      keepRuntime();
      registry.dispose();
    },
  };
};

export type FakeCheckout = Awaited<ReturnType<typeof makeFakeCheckout>>;

/**
 * Resolves with the atom's first value that `matches`, as a screen waits for
 * a state. The atom stays mounted while waiting.
 */
export const waitForValue = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  matches: (value: A) => boolean
): Promise<A> =>
  new Promise((resolve) => {
    let settled = false;
    const unsubscribe = registry.subscribe(
      atom,
      (result) => {
        if (settled || !AsyncResult.isSuccess(result)) return;
        if (!matches(result.value)) return;
        settled = true;
        queueMicrotask(() => unsubscribe());
        resolve(result.value);
      },
      { immediate: true }
    );
  });

/**
 * Resolves once the fake Workspace received a request to `endpoint`, so a
 * test can move the clock while that request is in flight.
 */
export const untilCalled = async (
  workspace: FakeWorkspace,
  endpoint: string,
  attempts = 500
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if ((workspace.calls as ReadonlyArray<string>).includes(endpoint)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`The fake Workspace never received ${endpoint}`);
};
