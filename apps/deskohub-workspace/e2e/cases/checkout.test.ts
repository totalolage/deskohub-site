import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import { testEmailAddress } from "@deskohub/test-email";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { WorkspaceE2EStepRunner } from "../case-runner";
import { preparedReservationForm } from "../checkout/reservation-form-preparation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import { makeWorkspaceE2EHostedPaymentPermitRecorder } from "../coordination/hosted-payment-permit.service.mock";
import {
  type WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData, CheckoutFlowState, CheckoutRow } from "../types";
import {
  assertFreshPaymentAttempt,
  completeHostedCheckoutPayment,
  executeCheckoutFlow,
} from "./checkout";

const customer: Customer = {
  _cloudId: "customer-id",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: null,
  email: testEmailAddress("customer"),
  phone: null,
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};

const checkoutRow = {
  dotypos_customer_id: "dotypos-customer-id",
  dotypos_reservation_id: "dotypos-reservation-id",
  locale: "en-US",
  reservation_details: {
    kind: "meeting-room",
    duration: { unit: "day", amount: 1 },
  },
  reservation_id: "workspace-reservation-id",
} as CheckoutRow;

const wholeDayData = {
  expectedReservationDetails: {
    kind: "meeting-room",
    duration: { unit: "day", amount: 1 },
  },
  meetingRoom: {
    duration: { unit: "day", amount: 1 },
    startsAt: "2027-03-27T23:00:00Z",
    endsAt: "2027-03-28T22:00:00Z",
    startDateTime: "2027-03-28T00:00",
  },
} as Pick<CheckoutData, "expectedReservationDetails" | "meetingRoom">;

describe("whole-day meeting-room checkout proof", () => {
  test("renders both shared email detail projections from the confirmed DST calendar day", async () => {
    const { assertWholeDayMeetingRoomEmailPreviews } = await import(
      "./checkout"
    );

    await expect(
      Effect.runPromise(
        assertWholeDayMeetingRoomEmailPreviews({
          checkoutRow,
          data: wholeDayData,
          dotyposReservation: {
            customer,
            reservedFrom: Temporal.Instant.from("2027-03-27T23:00:00Z"),
            reservedUntil: Temporal.Instant.from("2027-03-28T22:00:00Z"),
          },
        })
      )
    ).resolves.toBeUndefined();
  });

  test("rejects a confirmed interval that is not one Prague calendar day", async () => {
    const { assertWholeDayMeetingRoomEmailPreviews } = await import(
      "./checkout"
    );

    await expect(
      Effect.runPromise(
        assertWholeDayMeetingRoomEmailPreviews({
          checkoutRow,
          data: wholeDayData,
          dotyposReservation: {
            customer,
            reservedFrom: Temporal.Instant.from("2027-03-28T00:00:00Z"),
            reservedUntil: Temporal.Instant.from("2027-03-29T00:00:00Z"),
          },
        })
      )
    ).rejects.toThrow(
      "confirmed Dotypos reservation is not one Prague calendar day"
    );
  });
});

const runCheckoutFlowSteps = async (
  options: Pick<
    Parameters<typeof executeCheckoutFlow>[0],
    "verifyPostFulfillmentPaths"
  > = {}
) => {
  const hostedPaymentPermit = makeWorkspaceE2EHostedPaymentPermitRecorder();
  const observedSteps: Array<{
    readonly permit: "provider-verification" | undefined;
    readonly hosted: boolean;
    readonly id: string;
  }> = [];
  const orderId = "019f70bd-0131-7f30-9f8a-48e768f00292";
  const checkoutRow = {
    dotypos_customer_id: "dotypos-customer-paid",
  } as CheckoutRow;
  const runStep = ((step) => {
    observedSteps.push({
      permit: step.permit,
      hosted: hostedPaymentPermit.isHolding(),
      id: step.id,
    });
    if (step.id === "prepare-checkout-pay-page") {
      return Effect.succeed(orderId);
    }
    if (
      step.id === "read-provider-session-row" ||
      step.id === "validate-postgres-state"
    ) {
      return Effect.succeed(checkoutRow);
    }
    if (step.id === "validate-dotypos-reservation") {
      return Effect.succeed({});
    }
    return Effect.void;
  }) as WorkspaceE2EStepRunner;
  const data = {} as CheckoutData;
  const state: CheckoutFlowState = { data };
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        Object.assign(
          () =>
            Promise.reject(
              new Error("HTTP must not execute in the step contract test")
            ),
          { preconnect: globalThis.fetch.preconnect }
        )
      )
    )
  );

  await Effect.runPromise(
    executeCheckoutFlow({
      ...options,
      config: { timeouts: workspaceE2ETimeouts } as WorkspaceE2EConfig,
      data,
      datasourceConfig: {} as DatasourceConfig,
      flow: {
        id: "checkout-capacity-contract",
        toReservationPreparation: () => preparedReservationForm,
      },
      payPageSteps: () => [
        {
          execute: Effect.void,
          id: "pay-page-assertion",
          timeoutMs: workspaceE2ETimeouts.uiTransition,
        },
      ],
      run: (() =>
        Promise.reject(new Error("runner must not execute"))) as Runner,
      runStep,
      session: "checkout-capacity-contract",
      state,
    }).pipe(
      Effect.provide(Layer.mergeAll(httpClientLayer, hostedPaymentPermit.layer))
    ) as Effect.Effect<void>
  );
  return observedSteps;
};

test("holds the hosted-payment permit from Nexi submission through the status page", async () => {
  const observedSteps = await runCheckoutFlowSteps();

  expect(
    observedSteps.filter(({ hosted }) => hosted).map(({ id }) => id)
  ).toEqual([
    "start-checkout-payment",
    "read-provider-session-row",
    "complete-hosted-payment",
    "reach-checkout-status-page",
  ]);
  // The two permits never nest, so neither can wait while holding the other.
  expect(
    observedSteps.find(({ id }) => id === "replay-payment-webhook")?.hosted
  ).toBe(false);
});

test("holds the provider-verification permit only for the webhook replay", async () => {
  const observedSteps = await runCheckoutFlowSteps({
    verifyPostFulfillmentPaths: true,
  });

  expect(
    observedSteps.flatMap(({ id, permit }) =>
      permit === undefined ? [] : [{ id, permit }]
    )
  ).toEqual([
    {
      permit: "provider-verification",
      id: "replay-payment-webhook",
    },
  ]);
});

test("runs the post-fulfillment paths only for an opted-in case, after every fulfilled assertion", async () => {
  const defaultSteps = (await runCheckoutFlowSteps()).map(({ id }) => id);
  const optedInSteps = (
    await runCheckoutFlowSteps({ verifyPostFulfillmentPaths: true })
  ).map(({ id }) => id);
  const postFulfillmentSteps = optedInSteps.slice(defaultSteps.length);

  expect(optedInSteps.slice(0, defaultSteps.length)).toEqual(defaultSteps);
  expect(postFulfillmentSteps).toContain(
    "restart-reservation-after-fulfillment"
  );
  expect(postFulfillmentSteps).toContain(
    "mark-fulfillment-failed-for-support-path"
  );
  expect(defaultSteps).not.toContain("restart-reservation-after-fulfillment");
  expect(defaultSteps).not.toContain(
    "mark-fulfillment-failed-for-support-path"
  );
  // Status isolation starts from the support path's failed-fulfillment state.
  expect(optedInSteps.indexOf("assert-reservation-status-isolation")).toBe(
    optedInSteps.length - 1
  );
  expect(
    optedInSteps.indexOf("mark-fulfillment-failed-for-support-path")
  ).toBeGreaterThan(
    optedInSteps.indexOf("restart-reservation-after-fulfillment")
  );
});

describe("Nexi sandbox payment restart", () => {
  const firstRow = {
    payment_attempt_id: "first-attempt",
    provider_order_id: "first-nexi-order",
  } as CheckoutRow;
  const retryRow = {
    payment_attempt_id: "retry-attempt",
    provider_order_id: "retry-nexi-order",
  } as CheckoutRow;
  const hostedPaymentPage = {
    checkoutPageUrl: "https://workspace.test/en-US/reservation/order-id",
    checkoutTabId: "checkout-tab",
    hostedPaymentTabId: "checkout-tab",
    url: "https://xpay.nexigroup.com/hpp/nexi/",
  };
  const sandboxRejection = () =>
    workspaceE2EError("Nexi rejected the card-data save", {
      diagnosticCode: "nexi_hosted_continue_card_submission_rejected",
      operation: "Nexi control",
    });

  const payWithSteps = ({
    hostedPaymentFailures,
    restarted = true,
  }: {
    readonly hostedPaymentFailures: Record<string, WorkspaceE2EError>;
    readonly restarted?: boolean;
  }) => {
    const hostedPaymentPermit = makeWorkspaceE2EHostedPaymentPermitRecorder();
    const stepIds: string[] = [];
    const stepsOutsidePermit: string[] = [];
    const runStep = ((step) => {
      stepIds.push(step.id);
      if (!hostedPaymentPermit.isHolding()) stepsOutsidePermit.push(step.id);
      if (step.id.startsWith("start-checkout-payment"))
        return Effect.succeed(hostedPaymentPage);
      if (step.id === "read-provider-session-row")
        return Effect.succeed(firstRow);
      if (step.id === "read-provider-session-row-retry")
        return Effect.succeed(retryRow);
      if (step.id === "restart-sandbox-rejected-payment")
        return Effect.succeed(restarted);
      const failure = hostedPaymentFailures[step.id];
      return failure ? Effect.fail(failure) : Effect.void;
    }) as WorkspaceE2EStepRunner;
    const data = {} as CheckoutData;
    const result = Effect.runPromiseExit(
      completeHostedCheckoutPayment({
        config: { timeouts: workspaceE2ETimeouts } as WorkspaceE2EConfig,
        data,
        orderId: "order-id" as CheckoutRow["reservation_id"],
        run: (() =>
          Promise.reject(new Error("runner must not execute"))) as Runner,
        runStep,
        session: "nexi-sandbox-restart",
        state: { data },
      }).pipe(
        Effect.provideService(E2EDatabase, E2EDatabase.of({ db: {} as never })),
        Effect.provide(hostedPaymentPermit.layer)
      )
    );
    return { result, stepIds, stepsOutsidePermit };
  };

  const failureOf = (exit: Exit.Exit<CheckoutRow, WorkspaceE2EError>) =>
    Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined;

  test("restarts a card-data rejection once and continues with the fresh attempt", async () => {
    const { result, stepIds, stepsOutsidePermit } = payWithSteps({
      hostedPaymentFailures: { "complete-hosted-payment": sandboxRejection() },
    });

    expect(await result).toEqual(Exit.succeed(retryRow));
    // One hosted-payment permit covers the rejected attempt and its restart.
    expect(stepsOutsidePermit).toEqual([]);
    expect(stepIds).toEqual([
      "start-checkout-payment",
      "read-provider-session-row",
      "complete-hosted-payment",
      "restart-sandbox-rejected-payment",
      "start-checkout-payment-retry",
      "read-provider-session-row-retry",
      "complete-hosted-payment-retry",
      "reach-checkout-status-page-retry",
    ]);
  });

  test("fails with the original rejection when the restart is declined", async () => {
    const rejection = sandboxRejection();
    const { result, stepIds } = payWithSteps({
      hostedPaymentFailures: { "complete-hosted-payment": rejection },
      restarted: false,
    });

    expect(failureOf(await result)).toEqual(Option.some(rejection));
    expect(stepIds.at(-1)).toBe("restart-sandbox-rejected-payment");
  });

  test("never restarts the restarted attempt", async () => {
    const retryRejection = sandboxRejection();
    const { result, stepIds } = payWithSteps({
      hostedPaymentFailures: {
        "complete-hosted-payment": sandboxRejection(),
        "complete-hosted-payment-retry": retryRejection,
      },
    });

    expect(failureOf(await result)).toEqual(Option.some(retryRejection));
    expect(
      stepIds.filter((id) => id === "restart-sandbox-rejected-payment")
    ).toHaveLength(1);
    expect(stepIds.at(-1)).toBe("complete-hosted-payment-retry");
  });

  test("never restarts timeouts or failures that are not sandbox rejections", async () => {
    for (const failure of [
      workspaceE2ETimeoutError("Nexi continue timed out", {
        diagnosticCode: "nexi_hosted_continue_card_submission_rejected",
      }),
      workspaceE2EError("Nexi Pay control stayed disabled", {
        diagnosticCode: "nexi_hosted_pay_pay_disabled",
      }),
      workspaceE2EError("checkout row assertion failed"),
    ]) {
      const { result, stepIds } = payWithSteps({
        hostedPaymentFailures: { "complete-hosted-payment": failure },
      });

      expect(failureOf(await result)).toEqual(Option.some(failure));
      expect(stepIds).not.toContain("restart-sandbox-rejected-payment");
    }
  });

  test("requires a fresh payment attempt and Nexi order", () => {
    expect(() => assertFreshPaymentAttempt(firstRow, retryRow)).not.toThrow();
    expect(() =>
      assertFreshPaymentAttempt(firstRow, {
        ...retryRow,
        payment_attempt_id: firstRow.payment_attempt_id,
      })
    ).toThrow("restarted payment reused the rejected payment attempt");
    expect(() =>
      assertFreshPaymentAttempt(firstRow, {
        ...retryRow,
        provider_order_id: firstRow.provider_order_id,
      })
    ).toThrow("restarted payment reused the rejected Nexi order");
  });
});
