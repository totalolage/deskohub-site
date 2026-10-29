import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer } from "effect";
import type { ICampaignDeliveryStatusService } from "@/features/email-campaigns/backend/campaign-delivery-status.service";
import type { ResendWebhookRuntimeConfigObj } from "./resend-webhook.config";
import type {
  IReservationFulfillment,
  ReservationAccessDeliveryReport,
  ReservationDeliveryOutcome,
} from "./reservation-fulfillment.service";

let verifiedPayload: unknown;

const constructResend = mock((_apiKey?: string) => undefined);

const verifyWebhook = mock(
  (_input: {
    readonly payload: string;
    readonly headers: {
      readonly id: string;
      readonly timestamp: string;
      readonly signature: string;
    };
    readonly webhookSecret: string;
  }) => {
    return verifiedPayload;
  }
);

mock.module("resend", () => ({
  Resend: class {
    constructor(apiKey?: string) {
      constructResend(apiKey);
    }

    webhooks = {
      verify: verifyWebhook,
    };
  },
}));

const customerEmailDeliveryId = EmailDeliveryIdSchema.make("resend-email-id");

const customerWebhookPayload = (
  type: "email.delivered" | "email.failed" | "email.bounced",
  created_at = "2026-01-01T12:05:00.000Z"
) => ({
  type,
  created_at,
  data: {
    email_id: "resend-email-id",
    tags: [
      { name: "source", value: "workspace-paid-fulfillment" },
      { name: "category", value: "workspace-paid-reservation-access" },
      { name: "deploymentEnvironment", value: "development" },
      { name: "workspaceReservationId", value: "reservation-id" },
      { name: "dotyposReservationId", value: "dotypos-reservation-id" },
      { name: "dotyposCustomerId", value: "dotypos-customer-id" },
    ],
  },
});

const customerDeliveredPayload = customerWebhookPayload("email.delivered");
const customerFailurePayload = customerWebhookPayload("email.failed");
const customerBouncedPayload = customerWebhookPayload("email.bounced");

const internalFailurePayload = {
  type: "email.bounced",
  created_at: "2026-01-01T12:05:00.000Z",
  data: {
    email_id: "resend-email-id",
    tags: [
      { name: "source", value: "workspace-paid-fulfillment" },
      { name: "category", value: "workspace-paid-reservation-internal" },
      { name: "deploymentEnvironment", value: "development" },
      { name: "workspaceReservationId", value: "reservation-id" },
    ],
  },
};

const authorConfirmationBouncedPayload = {
  type: "email.bounced",
  created_at: "2026-01-01T12:05:00.000Z",
  data: {
    email_id: "resend-email-id",
    tags: [
      { name: "source", value: "workspace-paid-fulfillment" },
      {
        name: "category",
        value: "workspace-reservation-author-confirmation",
      },
      { name: "deploymentEnvironment", value: "development" },
      { name: "workspaceReservationId", value: "reservation-id" },
    ],
  },
};

const campaignComplaintPayload = {
  type: "email.complained",
  created_at: "2026-01-01T12:05:00.000Z",
  data: {
    email_id: "resend-campaign-email-id",
    tags: [
      { name: "category", value: "email-campaign" },
      { name: "campaignSendId", value: "campaign-send-id" },
      { name: "dotyposCustomerId", value: "dotypos-customer-id" },
      { name: "deploymentEnvironment", value: "development" },
    ],
  },
};

interface RawWebhookRequest {
  readonly payload: string;
  readonly headers: {
    readonly id?: string | null;
    readonly timestamp?: string | null;
    readonly signature?: string | null;
  };
}

const validRawWebhookRequest: RawWebhookRequest = {
  payload: "raw-payload",
  headers: {
    id: "webhook-event-id",
    timestamp: "1710000000",
    signature: "v1,signature",
  },
};

interface ProcessWebhookInput {
  readonly recordDelivery?: IReservationFulfillment["recordDelivery"];
  readonly config?: ResendWebhookRuntimeConfigObj;
  readonly request?: RawWebhookRequest;
  readonly recordCampaignDelivery?: ICampaignDeliveryStatusService["record"];
}

const recordDeliveryAs = (outcome: ReservationDeliveryOutcome) =>
  mock((_report: ReservationAccessDeliveryReport) => Effect.succeed(outcome));

const processWebhook = async (input: ProcessWebhookInput) =>
  Effect.runPromise(await processWebhookEffect(input));

const processWebhookError = async (input: ProcessWebhookInput) =>
  Effect.runPromise(Effect.flip(await processWebhookEffect(input)));

const processWebhookEffect = async (input: ProcessWebhookInput) => {
  const { ResendWebhookService } = await import("./resend-webhook.service");
  const { ResendWebhookRuntimeConfig } = await import(
    "./resend-webhook.config"
  );
  const { ReservationFulfillment } = await import(
    "./reservation-fulfillment.service"
  );
  const { CampaignDeliveryStatusService } = await import(
    "@/features/email-campaigns/backend/campaign-delivery-status.service"
  );

  const config = input.config ?? {
    apiKey: "re_test",
    deploymentEnvironment: "development",
    webhookSecret: "whsec_test",
  };

  return Effect.gen(function* () {
    const service = yield* ResendWebhookService;
    return yield* service.processWebhook(
      input.request ?? validRawWebhookRequest
    );
  }).pipe(
    Effect.provide(
      ResendWebhookService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ReservationFulfillment, {
              recordDelivery: input.recordDelivery,
            }),
            Layer.succeed(ResendWebhookRuntimeConfig, config),
            Layer.mock(CampaignDeliveryStatusService, {
              record: input.recordCampaignDelivery,
            })
          )
        )
      )
    )
  );
};

const withTag = (
  payload: ReturnType<typeof customerWebhookPayload>,
  name: string,
  value: string | undefined
) => ({
  ...payload,
  data: {
    ...payload.data,
    tags: payload.data.tags.flatMap((tag) => {
      if (tag.name !== name) return [tag];
      return value === undefined ? [] : [{ name, value }];
    }),
  },
});

const reportedCustomerDelivery = {
  deliveryId: customerEmailDeliveryId,
  outcome: "delivered",
  occurredAt: Temporal.Instant.from("2026-01-01T12:05:00.000Z"),
  accessEmail: { reservationId: "reservation-id", deployment: "current" },
};

describe("ResendWebhookService", () => {
  beforeEach(() => {
    verifiedPayload = undefined;
    verifyWebhook.mockClear();
    constructResend.mockClear();
  });

  test("verifies a customer access delivery and hands fulfillment the decoded report", async () => {
    verifiedPayload = customerDeliveredPayload;
    const recordDelivery = recordDeliveryAs("applied");

    const result = await processWebhook({ recordDelivery });

    expect(result).toEqual({ status: "processed" });
    expect(constructResend).toHaveBeenCalledWith("re_test");
    expect(verifyWebhook).toHaveBeenCalledWith({
      payload: "raw-payload",
      headers: {
        id: "webhook-event-id",
        timestamp: "1710000000",
        signature: "v1,signature",
      },
      webhookSecret: "whsec_test",
    });
    expect(recordDelivery).toHaveBeenCalledTimes(1);
    expect(recordDelivery.mock.calls[0]?.[0]).toEqual(
      reportedCustomerDelivery as never
    );
  });

  test.each([
    ["email.failed", customerFailurePayload],
    ["email.bounced", customerBouncedPayload],
  ])("reports %s as a failed delivery", async (_, payload) => {
    verifiedPayload = payload;
    const recordDelivery = recordDeliveryAs("applied");

    const result = await processWebhook({ recordDelivery });

    expect(result).toEqual({ status: "processed" });
    expect(recordDelivery.mock.calls[0]?.[0]).toEqual({
      ...reportedCustomerDelivery,
      outcome: "failed",
    } as never);
  });

  test.each([
    ["the internal notification", internalFailurePayload],
    ["the author confirmation", authorConfirmationBouncedPayload],
    [
      "an email from another source",
      withTag(customerFailurePayload, "source", "workspace-other"),
    ],
    [
      "an email without a reservation ID",
      withTag(customerFailurePayload, "workspaceReservationId", undefined),
    ],
    [
      "an email with an invalid reservation ID",
      withTag(customerFailurePayload, "workspaceReservationId", ""),
    ],
  ])("reports %s without a customer access email", async (_, payload) => {
    verifiedPayload = payload;
    const recordDelivery = recordDeliveryAs({ ignored: "unrelated_email" });

    const result = await processWebhook({ recordDelivery });

    expect(result).toEqual({ status: "ignored", reason: "unrelated_email" });
    expect(recordDelivery.mock.calls[0]?.[0]).toEqual({
      deliveryId: customerEmailDeliveryId,
      outcome: "failed",
      occurredAt: Temporal.Instant.from("2026-01-01T12:05:00.000Z"),
    } as never);
  });

  test.each([
    ["this deployment", "development", "current"],
    ["another deployment", "production", "other"],
    ["no deployment", undefined, "missing"],
  ] as const)(
    "classifies an access email tagged for %s",
    async (_, deploymentEnvironment, deployment) => {
      verifiedPayload = withTag(
        customerDeliveredPayload,
        "deploymentEnvironment",
        deploymentEnvironment
      );
      const recordDelivery = recordDeliveryAs("applied");

      await processWebhook({ recordDelivery });

      expect(recordDelivery.mock.calls[0]?.[0]?.accessEmail).toEqual({
        reservationId: "reservation-id" as never,
        deployment,
      });
    }
  );

  test("answers ignored with the reason fulfillment gives", async () => {
    verifiedPayload = customerDeliveredPayload;

    const result = await processWebhook({
      recordDelivery: recordDeliveryAs({
        ignored: "reservation_delivery_state_changed",
      }),
    });

    expect(result).toEqual({
      status: "ignored",
      reason: "reservation_delivery_state_changed",
    });
  });

  test.each([
    [
      "delivery_unattached",
      customerDeliveredPayload,
      "resend_webhook_delivery_unattached",
      "Resend webhook referenced the customer delivery before it was attached to a reservation.",
    ],
    [
      "reservation_load_failed",
      customerDeliveredPayload,
      "resend_webhook_reservation_load_failed",
      "Resend webhook could not load the reservation for the delivered email.",
    ],
    [
      "invoice_processing_failed",
      customerDeliveredPayload,
      "resend_webhook_invoice_processing_failed",
      "Resend webhook invoice processing failed.",
    ],
    [
      "reservation_update_failed",
      customerDeliveredPayload,
      "resend_webhook_reservation_update_failed",
      "Resend webhook could not mark reservation fulfilled.",
    ],
    [
      "reservation_update_failed",
      customerFailurePayload,
      "resend_webhook_reservation_update_failed",
      "Resend webhook could not mark reservation fulfillment failed.",
    ],
  ] as const)(
    "maps an unapplied %s report to its webhook error",
    async (reason, payload, errorCode, message) => {
      verifiedPayload = payload;
      const { ReservationDeliveryReportError } = await import(
        "./reservation-fulfillment.service"
      );
      const cause = new Error("synthetic delivery report failure");

      const error = await processWebhookError({
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

      expect(error).toMatchObject({
        _tag: "ResendWebhookProcessingError",
        errorCode,
        message,
        eventId: "webhook-event-id",
        workspaceReservationId: "reservation-id",
        cause,
      });
    }
  );

  test("ignores delivery-unrelated events without reporting them", async () => {
    verifiedPayload = { ...customerDeliveredPayload, type: "email.opened" };
    const recordDelivery = recordDeliveryAs("applied");

    const result = await processWebhook({ recordDelivery });

    expect(result).toEqual({ status: "ignored", reason: "non_delivery_event" });
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test("rejects a delivery event without an email ID", async () => {
    const { email_id: _, ...dataWithoutEmailId } =
      customerDeliveredPayload.data;
    verifiedPayload = { ...customerDeliveredPayload, data: dataWithoutEmailId };
    const recordDelivery = recordDeliveryAs("applied");

    const error = await processWebhookError({ recordDelivery });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_payload_invalid",
      eventId: "webhook-event-id",
    });
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test("fails Resend webhook processing for invalid payloads", async () => {
    verifiedPayload = { data: { tags: [] }, type: 42 };
    const recordDelivery = recordDeliveryAs("applied");

    const error = await processWebhookError({ recordDelivery });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_payload_invalid",
      eventId: "webhook-event-id",
    });
    expect(verifyWebhook).toHaveBeenCalled();
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test("records campaign complaint events without touching reservations", async () => {
    verifiedPayload = campaignComplaintPayload;
    const recordCampaignDelivery = mock<
      ICampaignDeliveryStatusService["record"]
    >((_) => Effect.succeed({ status: "processed" }));
    const recordDelivery = recordDeliveryAs("applied");

    const result = await processWebhook({
      recordDelivery,
      recordCampaignDelivery,
    });

    expect(result).toEqual({ status: "processed" });
    const [recorded] = recordCampaignDelivery.mock.calls[0] ?? [];
    expect(recorded).toMatchObject({
      type: "email.complained",
      providerMessageId: "resend-campaign-email-id",
    });
    expect(recorded?.tags).toEqual(
      new Map([
        ["category", "email-campaign"],
        ["campaignSendId", "campaign-send-id"],
        ["dotyposCustomerId", "dotypos-customer-id"],
        ["deploymentEnvironment", "development"],
      ])
    );
    expect(
      Temporal.Instant.compare(
        recorded?.occurredAt as Temporal.Instant,
        Temporal.Instant.from(campaignComplaintPayload.created_at)
      )
    ).toBe(0);
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test("ignores campaign events from another deployment environment", async () => {
    verifiedPayload = {
      ...campaignComplaintPayload,
      data: {
        ...campaignComplaintPayload.data,
        tags: campaignComplaintPayload.data.tags.map((tag) =>
          tag.name === "deploymentEnvironment"
            ? { ...tag, value: "production" }
            : tag
        ),
      },
    };
    const recordCampaignDelivery = mock<
      ICampaignDeliveryStatusService["record"]
    >(() => Effect.succeed({ status: "processed" }));
    const recordDelivery = recordDeliveryAs("applied");

    const result = await processWebhook({
      recordDelivery,
      recordCampaignDelivery,
    });

    expect(result).toEqual({
      status: "ignored",
      reason: "deployment_environment_mismatch",
    });
    expect(recordCampaignDelivery).not.toHaveBeenCalled();
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  test("maps campaign delivery record failures to a processing error", async () => {
    verifiedPayload = campaignComplaintPayload;
    const recordFailure = new Error("synthetic campaign record failure");
    const recordCampaignDelivery = mock<
      ICampaignDeliveryStatusService["record"]
    >(() => Effect.fail(recordFailure as never));
    const recordDelivery = recordDeliveryAs("applied");

    const error = await processWebhookError({
      recordDelivery,
      recordCampaignDelivery,
    });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_campaign_update_failed",
      eventId: "webhook-event-id",
      cause: recordFailure,
    });
    expect(recordCampaignDelivery).toHaveBeenCalledTimes(1);
    expect(recordDelivery).not.toHaveBeenCalled();
  });
});
