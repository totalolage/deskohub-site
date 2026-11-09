import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { ingestDeliveryReport } from "@/shared/backend/email/delivery-reports";
import {
  resendEmailEvent,
  restoreRealResendModule,
  signedResendWebhookRequest,
  syntheticWebhookSecret,
} from "@/shared/backend/email/delivery-reports.test-utils";
import { ResendWebhookConfig } from "@/shared/backend/email/resend-webhook.config";
import { customerAccessDeliveryReports } from "./reservation-delivery-reports";
import {
  type IReservationFulfillment,
  type ReservationAccessDeliveryReport,
  type ReservationDeliveryOutcome,
  ReservationDeliveryReportError,
  ReservationFulfillment,
} from "./reservation-fulfillment.service";

await restoreRealResendModule();

const webhookSecret = syntheticWebhookSecret();

const accessEmailTags = (overrides: Record<string, string | undefined> = {}) =>
  Object.entries({
    source: "workspace-paid-fulfillment",
    category: "workspace-paid-reservation-access",
    deploymentEnvironment: "development",
    workspaceReservationId: "reservation-id",
    dotyposReservationId: "dotypos-reservation-id",
    dotyposCustomerId: "dotypos-customer-id",
    ...overrides,
  }).flatMap(([name, value]) => (value === undefined ? [] : [{ name, value }]));

const accessEmailEvent = (
  type: string,
  tags: Record<string, string | undefined> = {}
) =>
  resendEmailEvent({
    type,
    emailId: "resend-email-id",
    tags: accessEmailTags(tags),
  });

const recordDeliveryAs = (outcome: ReservationDeliveryOutcome) =>
  mock((_report: ReservationAccessDeliveryReport) => Effect.succeed(outcome));

const ingest = (input: {
  readonly payload: string;
  readonly recordDelivery: IReservationFulfillment["recordDelivery"];
}) => {
  const { request, eventId } = signedResendWebhookRequest({
    secret: webhookSecret,
    payload: input.payload,
  });
  return {
    eventId,
    result: ingestDeliveryReport(request, [customerAccessDeliveryReports]).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ResendWebhookConfig, {
            apiKey: "re_test",
            deploymentEnvironment: "development",
            webhookSecret,
          }),
          Layer.mock(ReservationFulfillment, {
            recordDelivery: input.recordDelivery,
          })
        )
      )
    ),
  };
};

const reportedDelivery = {
  deliveryId: "resend-email-id",
  outcome: "delivered",
  occurredAt: Temporal.Instant.from("2026-01-01T12:05:00.000Z"),
  accessEmail: { reservationId: "reservation-id" },
};

describe("customer access delivery reports", () => {
  test("hands fulfillment the decoded report of a delivered access email", async () => {
    const recordDelivery = recordDeliveryAs("applied");

    const result = await Effect.runPromise(
      ingest({ payload: accessEmailEvent("email.delivered"), recordDelivery })
        .result
    );

    expect(result).toEqual({ status: "processed" });
    expect(recordDelivery).toHaveBeenCalledTimes(1);
    expect(recordDelivery.mock.calls[0]?.[0]).toEqual(
      reportedDelivery as never
    );
  });

  test.each(["email.failed", "email.bounced"])(
    "reports %s as a failed delivery",
    async (type) => {
      const recordDelivery = recordDeliveryAs("applied");

      const result = await Effect.runPromise(
        ingest({ payload: accessEmailEvent(type), recordDelivery }).result
      );

      expect(result).toEqual({ status: "processed" });
      expect(recordDelivery.mock.calls[0]?.[0]).toEqual({
        ...reportedDelivery,
        outcome: "failed",
      } as never);
    }
  );

  test.each([
    ["another source", { source: "workspace-other" }],
    ["no reservation ID", { workspaceReservationId: undefined }],
    ["an invalid reservation ID", { workspaceReservationId: "" }],
  ])(
    "reports an access email with %s without its reservation",
    async (_, tags) => {
      const recordDelivery = recordDeliveryAs({ ignored: "unrelated_email" });

      const result = await Effect.runPromise(
        ingest({
          payload: accessEmailEvent("email.failed", tags),
          recordDelivery,
        }).result
      );

      expect(result).toEqual({ status: "ignored", reason: "unrelated_email" });
      expect(recordDelivery.mock.calls[0]?.[0]).toEqual({
        deliveryId: "resend-email-id",
        outcome: "failed",
        occurredAt: Temporal.Instant.from("2026-01-01T12:05:00.000Z"),
      } as never);
    }
  );

  test.each([
    [
      "the internal notification",
      { category: "workspace-paid-reservation-internal" },
    ],
    [
      "the author confirmation",
      { category: "workspace-reservation-author-confirmation" },
    ],
  ])("leaves reports of %s to no handler", async (_, tags) => {
    const recordDelivery = recordDeliveryAs("applied");

    const result = await Effect.runPromise(
      ingest({
        payload: accessEmailEvent("email.bounced", tags),
        recordDelivery,
      }).result
    );

    expect(result).toEqual({
      status: "ignored",
      reason: "unhandled_email_kind",
    });
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test.each([
    ["another", "production", "deployment_environment_mismatch"],
    ["no", undefined, "deployment_environment_missing"],
  ] as const)(
    "ignores an access email tagged for %s deployment",
    async (_, deploymentEnvironment, reason) => {
      const recordDelivery = recordDeliveryAs("applied");

      const result = await Effect.runPromise(
        ingest({
          payload: accessEmailEvent("email.delivered", {
            deploymentEnvironment,
          }),
          recordDelivery,
        }).result
      );

      expect(result).toEqual({ status: "ignored", reason });
      expect(recordDelivery).not.toHaveBeenCalled();
    }
  );

  test.each(["email.sent", "email.opened", "email.complained"])(
    "ignores %s without reporting it",
    async (type) => {
      const recordDelivery = recordDeliveryAs("applied");

      const result = await Effect.runPromise(
        ingest({ payload: accessEmailEvent(type), recordDelivery }).result
      );

      expect(result).toEqual({
        status: "ignored",
        reason: "non_delivery_event",
      });
      expect(recordDelivery).not.toHaveBeenCalled();
    }
  );

  test("rejects a delivery without an email ID before the deployment check", async () => {
    const recordDelivery = recordDeliveryAs("applied");
    const { eventId, result } = ingest({
      payload: resendEmailEvent({
        type: "email.delivered",
        tags: accessEmailTags({ deploymentEnvironment: undefined }),
      }),
      recordDelivery,
    });

    expect(await Effect.runPromise(Effect.flip(result))).toMatchObject({
      _tag: "DeliveryRequestError",
      errorCode: "resend_webhook_payload_invalid",
      eventId,
    });
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test("ignores a non-delivery event from another deployment as a non-delivery event", async () => {
    const recordDelivery = recordDeliveryAs("applied");

    const result = await Effect.runPromise(
      ingest({
        payload: accessEmailEvent("email.opened", {
          deploymentEnvironment: "production",
        }),
        recordDelivery,
      }).result
    );

    expect(result).toEqual({ status: "ignored", reason: "non_delivery_event" });
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test("answers ignored with the reason fulfillment gives", async () => {
    const result = await Effect.runPromise(
      ingest({
        payload: accessEmailEvent("email.delivered"),
        recordDelivery: recordDeliveryAs({
          ignored: "reservation_delivery_state_changed",
        }),
      }).result
    );

    expect(result).toEqual({
      status: "ignored",
      reason: "reservation_delivery_state_changed",
    });
  });

  test.each([
    [
      "delivery_unattached",
      "email.delivered",
      "resend_webhook_delivery_unattached",
      "Resend webhook referenced the customer delivery before it was attached to a reservation.",
    ],
    [
      "reservation_load_failed",
      "email.delivered",
      "resend_webhook_reservation_load_failed",
      "Resend webhook could not load the reservation for the delivered email.",
    ],
    [
      "invoice_processing_failed",
      "email.delivered",
      "resend_webhook_invoice_processing_failed",
      "Resend webhook invoice processing failed.",
    ],
    [
      "reservation_update_failed",
      "email.delivered",
      "resend_webhook_reservation_update_failed",
      "Resend webhook could not mark reservation fulfilled.",
    ],
    [
      "reservation_update_failed",
      "email.failed",
      "resend_webhook_reservation_update_failed",
      "Resend webhook could not mark reservation fulfillment failed.",
    ],
  ] as const)(
    "maps an unapplied %s report to its webhook error",
    async (reason, type, errorCode, message) => {
      const cause = new Error("synthetic delivery report failure");
      const { eventId, result } = ingest({
        payload: accessEmailEvent(type),
        recordDelivery: () =>
          Effect.fail(
            new ReservationDeliveryReportError({
              reason,
              message: "synthetic",
              workspaceReservationId: "reservation-id" as never,
              cause,
            })
          ),
      });

      const error = await Effect.runPromise(Effect.flip(result));

      expect(error).toMatchObject({
        _tag: "DeliveryReportError",
        errorCode,
        message,
        eventId,
        details: { workspaceReservationId: "reservation-id" },
        cause,
      });
    }
  );
});
