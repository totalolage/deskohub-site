import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { act, cleanup, renderHook } from "@testing-library/react";
import { m } from "@/features/i18n";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import {
  workspaceRouterPush as push,
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type PreparePayStateOptions = {
  readonly onSuccess: (result: {
    readonly data?:
      | {
          readonly status: "pricing_changed" | "ready";
          readonly redirectUrl?: string;
        }
      | { readonly status: "error"; readonly message: string };
  }) => void;
  readonly onError: (result: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

const executeAsync = mock((_input: PreparePayStateInput) =>
  Promise.resolve({})
);
let preparePayStateOptions: PreparePayStateOptions | undefined;

let analyticsAccepted = false;
const cookieConsent = await import("@/features/cookie-consent");
mock.module("@/features/cookie-consent", () => ({
  ...cookieConsent,
  useVisitorConsent: () => analyticsAccepted,
  visitorConsent: {
    ...cookieConsent.visitorConsent,
    accepts: () => analyticsAccepted,
  },
}));

const vercelAnalytics = await import("@vercel/analytics/react");
const track = mock(
  (..._args: Parameters<typeof vercelAnalytics.track>) => undefined
);
mock.module("@vercel/analytics/react", () => ({ ...vercelAnalytics, track }));

mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  preparePayState: mock(),
}));

const { useReservationCheckout } = await import("./use-reservation-checkout");

const reservationFor = (startHour: number) =>
  normalizedMeetingRoomReservationOrderSchema.make({
    kind: "meeting-room",
    duration: { unit: "hour", amount: 1 },
    reservationDate: "2099-07-30",
    startsAt: `2099-07-30T0${startHour}:00:00Z`,
    endsAt: `2099-07-30T0${startHour + 1}:00:00Z`,
    name: "Ada Lovelace",
    email: testEmailAddress("ada"),
    phone: "+420777777777",
  });

const genericError = m.reservationErrorMessage({}, { locale: "en-US" });

const renderCheckout = () =>
  renderHook(() => useReservationCheckout({ locale: "en-US" }));

const submittedAttemptIds = () =>
  executeAsync.mock.calls.map(([input]) => input.checkoutAttemptId);

describe("useReservationCheckout", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseAction.mockImplementation((_action, options) => {
      preparePayStateOptions = options as PreparePayStateOptions;
      return { executeAsync, isExecuting: false, result: {} };
    });
  });

  afterEach(() => {
    cleanup();
    executeAsync.mockClear();
    push.mockClear();
    workspaceUseAction.mockReset();
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    preparePayStateOptions = undefined;
    analyticsAccepted = false;
    track.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("reuses the checkout attempt for a resubmitted order and starts a new one when the order changes", () => {
    const { result } = renderCheckout();
    const start = (startHour: number) =>
      act(() => {
        result.current.startCheckout({
          advertisedPriceToken: "signed-price",
          reservation: reservationFor(startHour),
        });
      });

    start(7);
    start(7);
    start(8);
    start(8);

    const [first, resubmitted, changed, changedResubmitted] =
      submittedAttemptIds();
    expect(first).toBeString();
    expect(resubmitted).toBe(first);
    expect(changed).toBeString();
    expect(changed).not.toBe(first);
    expect(changedResubmitted).toBe(changed);
  });

  test("follows a pricing-changed redirect to the pay page", () => {
    renderCheckout();

    act(() => {
      preparePayStateOptions?.onSuccess({
        data: {
          status: "pricing_changed",
          redirectUrl: "/en-US/checkout/pay?payState=fresh",
        },
      });
    });

    expect(push).toHaveBeenCalledWith("/en-US/checkout/pay?payState=fresh");
  });

  test("shows the action's message when preparation fails", () => {
    const { result } = renderCheckout();
    const message = m.reservationMeetingRoomUnavailable(
      {},
      { locale: "en-US" }
    );

    act(() => {
      preparePayStateOptions?.onSuccess({
        data: { status: "error", message },
      });
    });

    expect(result.current.submissionError).toBe(message);
    expect(push).not.toHaveBeenCalled();
  });

  test("shows the generic error when a prepared checkout has no pay page", () => {
    const { result } = renderCheckout();

    act(() => {
      preparePayStateOptions?.onSuccess({ data: { status: "ready" } });
    });

    expect(result.current.submissionError).toBe(genericError);
    expect(push).not.toHaveBeenCalled();
  });

  test("tracks a started checkout once per submission with analytics consent", () => {
    analyticsAccepted = true;
    renderCheckout();
    const succeed = () =>
      act(() => {
        preparePayStateOptions?.onSuccess({
          data: { status: "ready", redirectUrl: "/en-US/checkout/pay" },
        });
      });

    succeed();
    succeed();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0]?.[0]).toBe("workspace_checkout_started");
    expect(push).toHaveBeenCalledTimes(2);
  });

  test("tracks nothing without analytics consent", () => {
    renderCheckout();

    act(() => {
      preparePayStateOptions?.onSuccess({
        data: { status: "ready", redirectUrl: "/en-US/checkout/pay" },
      });
    });

    expect(track).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/en-US/checkout/pay");
  });

  test("shows the server's error, or the generic one without it", () => {
    const { result } = renderCheckout();
    const serverError = m.reservationAvailabilityError({}, { locale: "en-US" });

    act(() => {
      preparePayStateOptions?.onError({ error: { serverError } });
    });
    expect(result.current.submissionError).toBe(serverError);

    act(() => {
      preparePayStateOptions?.onError({ error: {} });
    });
    expect(result.current.submissionError).toBe(genericError);
  });

  test("shows the generic error when the request does not reach the server", () => {
    const { result } = renderCheckout();

    act(() => {
      preparePayStateOptions?.onTransportError();
    });

    expect(result.current.submissionError).toBe(genericError);
  });
});
