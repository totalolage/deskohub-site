import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { IReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import type { CapturePostHogEventInput } from "@/shared/backend/analytics/posthog-event.service";
import type {
  CheckoutStatusViewModel,
  ICheckoutStatusService,
} from "./checkout-status.service";
import { loadCheckoutStatusPage } from "./checkout-status-page.server";

const input = {
  accessCookie: undefined,
  locale: "en-US",
  orderId: "order-id",
  requestHeaders: new Headers(),
  returnOutcome: "success",
} as const;
const fulfilledStatus = {
  orderId: input.orderId,
  status: "fulfilled",
} as CheckoutStatusViewModel;

test("falls back to authoritative local status after a page refresh read fails", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("refresh read failed"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() => Effect.succeed(fulfilledStatus));
  const isAuthorized = mock(() => Effect.succeed(true));

  const result = await Effect.runPromise(
    loadCheckoutStatusPage(
      { getStatus, refreshStatus },
      { isAuthorized } as IReservationAuthorizationService,
      input
    )
  );

  expect(result).toBe(fulfilledStatus);
  expect(refreshStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledTimes(1);
  expect(getStatus).toHaveBeenCalledWith({
    orderId: input.orderId,
    returnOutcome: input.returnOutcome,
  });
  expect(isAuthorized).toHaveBeenCalledWith({
    accessCookie: undefined,
    locale: input.locale,
    orderId: input.orderId,
    permission: "view-status",
  });
});

test("does not read checkout status when reservation access is unauthorized", async () => {
  const refreshStatus = mock(() =>
    Effect.fail(new Error("must not refresh"))
  ) as ICheckoutStatusService["refreshStatus"];
  const getStatus = mock(() =>
    Effect.fail(new Error("must not read"))
  ) as ICheckoutStatusService["getStatus"];
  const isAuthorized = mock(() => Effect.succeed(false));

  const result = await Effect.runPromise(
    loadCheckoutStatusPage(
      { getStatus, refreshStatus },
      { isAuthorized } as IReservationAuthorizationService,
      input
    )
  );

  expect(result).toEqual({
    orderId: input.orderId,
    returnOutcome: input.returnOutcome,
    status: "not_found",
  });
  expect(isAuthorized).toHaveBeenCalledTimes(1);
  expect(refreshStatus).not.toHaveBeenCalled();
  expect(getStatus).not.toHaveBeenCalled();
});

test("attributes a payment the page refresh finalizes to the page request's agent", async () => {
  const { capturePaymentCompleted } = await import(
    "@/features/checkout/backend/analytics/posthog-lifecycle-events"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const captures: CapturePostHogEventInput[] = [];
  const refreshStatus = mock(() =>
    capturePaymentCompleted({
      attempt: {
        id: "019edbd2-82f7-7cc0-8536-f2b3874d62d5",
        workspaceReservationId: "019edbcf-5026-7ecc-821b-eda46998eaaa",
        provider: "nexi",
        amount: { value: 35_000, exponent: 2, currency: "CZK" },
      },
      timestamp: Temporal.Instant.from("2026-06-17T12:00:00.000Z"),
    }).pipe(
      Effect.provide(
        Layer.succeed(PostHogEventService, {
          alias: () => Effect.void,
          capture: (event) =>
            Effect.sync(() => {
              captures.push(event);
            }),
        })
      ),
      Effect.as(fulfilledStatus)
    )
  );

  await Effect.runPromise(
    loadCheckoutStatusPage(
      { getStatus: mock(() => Effect.succeed(fulfilledStatus)), refreshStatus },
      {
        isAuthorized: mock(() => Effect.succeed(true)),
      } as IReservationAuthorizationService,
      {
        ...input,
        requestHeaders: new Headers({
          "user-agent":
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
        }),
      }
    )
  );

  expect(captures).toHaveLength(1);
  expect(captures[0]?.properties).toMatchObject({
    agent_category: "ai_user_agent",
    agent_name: "chatgpt",
  });
});
