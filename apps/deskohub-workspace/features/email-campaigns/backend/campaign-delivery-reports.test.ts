import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { ingestDeliveryReport } from "@/shared/backend/email/delivery-reports";
import {
  resendEmailEvent,
  restoreRealResendModule,
  signedResendWebhookRequest,
  spanNameRecorder,
  syntheticWebhookSecret,
} from "@/shared/backend/email/delivery-reports.test-utils";
import { ResendWebhookConfig } from "@/shared/backend/email/resend-webhook.config";
import { campaignDeliveryReports } from "./campaign-delivery-reports";
import {
  CampaignDeliveryStatusService,
  type ICampaignDeliveryStatusService,
} from "./campaign-delivery-status.service";

await restoreRealResendModule();

const webhookSecret = syntheticWebhookSecret();

const campaignEvent = (
  type: string,
  tags: Record<string, string | undefined> = {},
  /** `null` sends no email ID. */
  emailId: string | null = "resend-campaign-email-id"
) =>
  resendEmailEvent({
    type,
    emailId: emailId ?? undefined,
    tags: Object.entries({
      category: "email-campaign",
      campaignSendId: "campaign-send-id",
      dotyposCustomerId: "dotypos-customer-id",
      deploymentEnvironment: "development",
      ...tags,
    }).flatMap(([name, value]) =>
      value === undefined ? [] : [{ name, value }]
    ),
  });

const recordProcessed = () =>
  mock<ICampaignDeliveryStatusService["record"]>(() =>
    Effect.succeed({ status: "processed" })
  );

const ingest = (input: {
  readonly payload: string;
  readonly record: ICampaignDeliveryStatusService["record"];
}) => {
  const { request, eventId } = signedResendWebhookRequest({
    secret: webhookSecret,
    payload: input.payload,
  });
  const spans = spanNameRecorder();
  return {
    eventId,
    spanNames: spans.names,
    result: ingestDeliveryReport(request, [campaignDeliveryReports]).pipe(
      Effect.withTracer(spans.tracer),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ResendWebhookConfig, {
            apiKey: "re_test",
            deploymentEnvironment: "development",
            webhookSecret,
          }),
          Layer.mock(CampaignDeliveryStatusService, { record: input.record })
        )
      )
    ),
  };
};

const campaignSpan = "resendWebhook.processCampaignEvent";

describe("campaign delivery reports", () => {
  test.each(["email.delivered", "email.bounced", "email.complained"] as const)(
    "records %s on the recipient its tags name",
    async (type) => {
      const record = recordProcessed();
      const { result, spanNames } = ingest({
        payload: campaignEvent(type),
        record,
      });

      expect(await Effect.runPromise(result)).toEqual({ status: "processed" });
      expect(record.mock.calls[0]?.[0]).toEqual({
        type: Option.some(type),
        providerMessageId: "resend-campaign-email-id",
        recipient: Option.some({
          campaignSendId: "campaign-send-id",
          dotyposCustomerId: "dotypos-customer-id",
        }),
        occurredAt: Temporal.Instant.from("2026-01-01T12:05:00.000Z"),
      } as never);
      expect(spanNames).toContain(campaignSpan);
    }
  );

  test.each([
    ["no send ID", { campaignSendId: undefined }],
    ["a blank customer ID", { dotyposCustomerId: " " }],
  ])("matches by message ID alone when the tags carry %s", async (_, tags) => {
    const record = recordProcessed();

    await Effect.runPromise(
      ingest({ payload: campaignEvent("email.bounced", tags), record }).result
    );

    expect(record.mock.calls[0]?.[0]?.recipient).toEqual(Option.none());
  });

  test("passes on the reason the recipient was left unchanged", async () => {
    const record = mock<ICampaignDeliveryStatusService["record"]>(() =>
      Effect.succeed({
        status: "ignored",
        reason: "campaign_recipient_unchanged",
      })
    );

    const result = await Effect.runPromise(
      ingest({ payload: campaignEvent("email.delivered"), record }).result
    );

    expect(result).toEqual({
      status: "ignored",
      reason: "campaign_recipient_unchanged",
    });
  });

  // The status record answers events that change no status, inside its own
  // span, as it did before the ingress moved out of checkout.
  test.each(["email.sent", "email.opened", "email.failed"])(
    "hands %s to the status record as no status event",
    async (type) => {
      const record = mock<ICampaignDeliveryStatusService["record"]>(() =>
        Effect.succeed({ status: "ignored", reason: "non_status_event" })
      );
      const { result, spanNames } = ingest({
        payload: campaignEvent(type),
        record,
      });

      expect(await Effect.runPromise(result)).toEqual({
        status: "ignored",
        reason: "non_status_event",
      });
      expect(record.mock.calls[0]?.[0]?.type).toEqual(Option.none());
      expect(spanNames).toContain(campaignSpan);
    }
  );

  test.each(["email.bounced", "email.opened"])(
    "ignores %s without an email ID before the status record",
    async (type) => {
      const record = recordProcessed();
      const { result, spanNames } = ingest({
        payload: campaignEvent(type, {}, null),
        record,
      });

      expect(await Effect.runPromise(result)).toEqual({
        status: "ignored",
        reason: "campaign_email_id_missing",
      });
      expect(record).not.toHaveBeenCalled();
      expect(spanNames).toContain(campaignSpan);
    }
  );

  test.each([
    ["another", "production", "deployment_environment_mismatch"],
    ["no", undefined, "deployment_environment_missing"],
  ] as const)(
    "ignores a campaign event from %s deployment inside the campaign span",
    async (_, deploymentEnvironment, reason) => {
      const record = recordProcessed();
      const { result, spanNames } = ingest({
        payload: campaignEvent("email.opened", { deploymentEnvironment }),
        record,
      });

      expect(await Effect.runPromise(result)).toEqual({
        status: "ignored",
        reason,
      });
      expect(record).not.toHaveBeenCalled();
      expect(spanNames).toContain(campaignSpan);
    }
  );

  test("maps a failed status update to a retryable webhook error", async () => {
    const cause = new Error("synthetic campaign update failure");
    const { eventId, result } = ingest({
      payload: campaignEvent("email.bounced"),
      record: () => Effect.fail(cause as never),
    });

    const error = await Effect.runPromise(Effect.flip(result));

    expect(error).toMatchObject({
      _tag: "DeliveryReportError",
      errorCode: "resend_webhook_campaign_update_failed",
      message: "Resend webhook could not record the campaign delivery status.",
      eventId,
      cause,
    });
  });
});
