import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer } from "effect";
import { ReservationFulfillment } from "@/features/checkout/backend/fulfillment";
import { CampaignDeliveryStatusService } from "@/features/email-campaigns/backend/campaign-delivery-status.service";
import { campaignTestEmailCategory } from "@/features/email-campaigns/campaign-email-kind";
import { deliveryReportHandlers } from "./delivery-report-handlers";
import {
  dispatchDeliveryReport,
  ingestDeliveryReport,
} from "./delivery-reports";
import {
  resendEmailEvent,
  restoreRealResendModule,
  signedResendWebhookRequest,
  syntheticWebhookSecret,
} from "./delivery-reports.test-utils";
import { postHogDeliveryReport } from "./posthog-delivery-report";
import { ResendWebhookConfig } from "./resend-webhook.config";

await restoreRealResendModule();

const webhookSecret = syntheticWebhookSecret();
const deploymentEnvironment = "preview";

/** The handlers' services, which must never be reached here. */
const unreachedServices = () => {
  const record = mock(() => Effect.die("campaign status recorded"));
  const recordDelivery = mock(() =>
    Effect.die("reservation delivery recorded")
  );
  return {
    calls: () => [...record.mock.calls, ...recordDelivery.mock.calls],
    layer: Layer.mergeAll(
      Layer.mock(CampaignDeliveryStatusService, { record }),
      Layer.mock(ReservationFulfillment, { recordDelivery })
    ),
  };
};

const ignoredAsUnhandled = {
  status: "ignored",
  reason: "unhandled_email_kind",
} as const;

// A campaign test email carries only its category tag, whichever provider
// sent it, so its reports end as ignored and a tracked one settles.
describe("Workspace delivery-report handlers on a campaign test email", () => {
  test("ignore its Resend webhook report as an unhandled kind", async () => {
    const services = unreachedServices();
    const { request } = signedResendWebhookRequest({
      secret: webhookSecret,
      payload: resendEmailEvent({
        type: "email.delivered",
        emailId: "resend-test-email-id",
        tags: [{ name: "category", value: campaignTestEmailCategory }],
      }),
    });

    const outcome = await Effect.runPromise(
      ingestDeliveryReport(request, deliveryReportHandlers).pipe(
        Effect.provide(
          Layer.mergeAll(
            services.layer,
            Layer.succeed(ResendWebhookConfig, {
              apiKey: "re_test",
              deploymentEnvironment,
              webhookSecret,
            })
          )
        )
      )
    );

    expect(outcome).toEqual(ignoredAsUnhandled);
    expect(services.calls()).toEqual([]);
  });

  test.each(["delivered", "failed", "bounced", "complained"] as const)(
    "ignore PostHog's polled %s status as an unhandled kind",
    async (status) => {
      const services = unreachedServices();
      const report = postHogDeliveryReport({
        messageId: EmailDeliveryIdSchema.make(crypto.randomUUID()),
        status,
        statusAt: null,
        tags: { category: campaignTestEmailCategory },
        polledAt: Temporal.Instant.from("2026-11-10T12:00:00Z"),
        deploymentEnvironment,
      });

      const outcome = await Effect.runPromise(
        dispatchDeliveryReport(report, deliveryReportHandlers).pipe(
          Effect.provide(services.layer)
        )
      );

      expect(outcome).toEqual(ignoredAsUnhandled);
      expect(services.calls()).toEqual([]);
    }
  );
});
