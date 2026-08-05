import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { Customer } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  CheckoutRow,
  WorkspaceE2EStepRunner,
} from "../types";
import { executeCheckoutFlow } from "./checkout";

const customer: Customer = {
  _cloudId: "customer-id",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: null,
  email: "customer@example.com",
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
  reservation_details: { kind: "meeting-room" },
  reservation_id: "workspace-reservation-id",
} as const;

const wholeDayData = {
  meetingRoom: {
    duration: { unit: "day", amount: 1 },
    startsAt: "2027-03-27T23:00:00Z",
    endsAt: "2027-03-28T22:00:00Z",
    startDateTime: "2027-03-28T00:00",
  },
} as const;

describe("whole-day meeting-room checkout proof", () => {
  test("keeps the deployed runner independent of app-bound persistence decoders", async () => {
    const source = await Bun.file(
      fileURLToPath(new URL("./checkout.ts", import.meta.url))
    ).text();

    expect(source).not.toContain("persistence-contracts");
    expect(source).not.toContain("@/features/i18n");
  });

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

  test("rejects legacy meeting-room details in local persistence", async () => {
    const { assertWholeDayMeetingRoomEmailPreviews } = await import(
      "./checkout"
    );

    await expect(
      Effect.runPromise(
        assertWholeDayMeetingRoomEmailPreviews({
          checkoutRow: {
            ...checkoutRow,
            reservation_details: {
              kind: "meeting-room",
              duration: { unit: "day", amount: 1 },
            },
          },
          data: wholeDayData,
          dotyposReservation: {
            customer,
            reservedFrom: Temporal.Instant.from("2027-03-27T23:00:00Z"),
            reservedUntil: Temporal.Instant.from("2027-03-28T22:00:00Z"),
          },
        })
      )
    ).rejects.toThrow();
  });
});

test("limits capacity only around reservation start and provider verification", async () => {
  const observedSteps: Array<{
    readonly capacity:
      | "provider-verification"
      | "reservation-start"
      | undefined;
    readonly id: string;
    readonly timeoutMs: number;
  }> = [];
  const orderId = "019f70bd-0131-7f30-9f8a-48e768f00292";
  const replayRow = {} as CheckoutRow;
  const runStep = ((step) => {
    observedSteps.push({
      capacity: step.capacity,
      id: step.id,
      timeoutMs: step.timeoutMs,
    });
    if (step.id === "prepare-checkout-pay-page") {
      return Effect.succeed(orderId);
    }
    if (
      step.id === "read-provider-session-row" ||
      step.id === "validate-postgres-state"
    ) {
      return Effect.succeed(replayRow);
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
      Layer.succeed(FetchHttpClient.Fetch, (() =>
        Promise.reject(
          new Error("HTTP must not execute in the step contract test")
        )) as typeof globalThis.fetch)
    )
  );

  await Effect.runPromise(
    executeCheckoutFlow({
      config: { timeouts: workspaceE2ETimeouts } as WorkspaceE2EConfig,
      data,
      datasourceConfig: {} as DatasourceConfig,
      flow: {
        id: "checkout-capacity-contract",
        submitReservationScript: () => "unused",
      },
      run: (() =>
        Promise.reject(new Error("runner must not execute"))) as Runner,
      runStep,
      session: "checkout-capacity-contract",
      state,
    }).pipe(Effect.provide(httpClientLayer)) as Effect.Effect<void>
  );

  expect(
    observedSteps.flatMap(({ capacity, id }) =>
      capacity === undefined ? [] : [{ capacity, id }]
    )
  ).toEqual([
    {
      capacity: "reservation-start",
      id: "prepare-checkout-pay-page",
    },
    {
      capacity: "provider-verification",
      id: "replay-payment-webhook",
    },
  ]);
  expect(observedSteps.slice(0, 7).map(({ id }) => id)).toEqual([
    "prepare-checkout-pay-page",
    "start-checkout-payment",
    "read-provider-session-row",
    "complete-hosted-payment",
    "reach-checkout-status-page",
    "replay-payment-webhook",
    "complete-test-fulfillment",
  ]);
  expect(
    observedSteps.slice(-6).map(({ id, timeoutMs }) => ({ id, timeoutMs }))
  ).toEqual([
    {
      id: "mark-fulfillment-failed-for-support-path",
      timeoutMs: workspaceE2ETimeouts.datasource,
    },
    {
      id: "open-fulfillment-failed-status-page",
      timeoutMs: workspaceE2ETimeouts.browserNavigation,
    },
    {
      id: "wait-for-fulfillment-support-link",
      timeoutMs: workspaceE2ETimeouts.uiTransition,
    },
    {
      id: "assert-fulfillment-support-link",
      timeoutMs: workspaceE2ETimeouts.browserAction,
    },
    {
      id: "activate-fulfillment-support-link",
      timeoutMs: workspaceE2ETimeouts.browserAction,
    },
    {
      id: "reach-fulfillment-support-contact-page",
      timeoutMs: workspaceE2ETimeouts.uiTransition,
    },
  ]);
});
