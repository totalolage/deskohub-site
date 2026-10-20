import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import type { ICampaignDeliveryStatusService } from "@/features/email-campaigns/backend/campaign-delivery-status.service";
import type { IWorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { CapturePostHogEventInput } from "@/shared/backend/analytics/posthog-event.service";
import type { ResendWebhookRuntimeConfigObj } from "./resend-webhook.config";

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

type PostHogCapture = (input: CapturePostHogEventInput) => Effect.Effect<void>;

const awaitingDeliveryReservation = {
  id: "reservation-id",
  activePaymentAttemptId: "payment-attempt-id",
  paymentState: "paid",
  fulfillmentState: "awaiting_delivery",
  fulfillmentFailureCode: null,
} as never;

const fulfilledReservation = {
  ...awaitingDeliveryReservation,
  dotyposReservationId: "dotypos-reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
  fulfillmentState: "fulfilled",
} as never;

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
  readonly reservations: Partial<WorkspaceReservationRepositoryType>;
  readonly config?: ResendWebhookRuntimeConfigObj;
  readonly request?: RawWebhookRequest;
  readonly posthogCapture?: PostHogCapture;
  readonly recordCampaignDelivery?: ICampaignDeliveryStatusService["record"];
}

const processWebhook = async (input: ProcessWebhookInput) => {
  const effect = await processWebhookEffect(input);
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(
        ReservationInvoiceService,
        ReservationInvoiceService.of({
          processByPaymentAttemptId: () => Effect.void,
        })
      )
    )
  );
};

const processWebhookError = async (input: ProcessWebhookInput) => {
  const effect = await processWebhookEffect(input);
  return Effect.runPromise(
    Effect.flip(
      effect.pipe(
        Effect.provideService(
          ReservationInvoiceService,
          ReservationInvoiceService.of({
            processByPaymentAttemptId: () => Effect.void,
          })
        )
      )
    )
  );
};

const processWebhookEffect = async (input: ProcessWebhookInput) => {
  const { ResendWebhookService } = await import("./resend-webhook.service");
  const { ResendWebhookRuntimeConfig } = await import(
    "./resend-webhook.config"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
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
            Layer.mock(WorkspaceReservationRepository, input.reservations),
            Layer.mock(PostHogEventService, {
              capture: input.posthogCapture ?? (() => Effect.void),
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

describe("ResendWebhookService", () => {
  beforeEach(() => {
    verifiedPayload = undefined;
    verifyWebhook.mockClear();
    constructResend.mockClear();
  });

  test("marks delivered customer reservation access emails fulfilled", async () => {
    verifiedPayload = customerDeliveredPayload;
    const capture = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.succeed(fulfilledReservation));
    const markDeliveryFailed = mock(() =>
      Effect.die("should not fail fulfillment")
    );
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation)
      ),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const effect = await processWebhookEffect({
      reservations,
      posthogCapture: capture,
    });
    const result = await Effect.runPromise(
      effect.pipe(
        Effect.provideService(
          ReservationInvoiceService,
          ReservationInvoiceService.of({
            processByPaymentAttemptId: processInvoice,
          })
        )
      )
    );

    expect(result).toEqual({ status: "processed" });
    expect(constructResend).toHaveBeenCalledWith("re_test");
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).toHaveBeenCalledWith(customerEmailDeliveryId);
    expect(markDeliveryFailed).not.toHaveBeenCalled();

    const [fulfillInput] = markFulfilled.mock.calls[0] ?? [];
    expect(fulfillInput).toMatchObject({
      customerEmailDeliveryId,
    });
    expect(fulfillInput.fulfilledAt).toBeInstanceOf(Temporal.Instant);
    expect(
      Temporal.Instant.compare(
        fulfillInput.fulfilledAt as Temporal.Instant,
        Temporal.Instant.from(customerDeliveredPayload.created_at)
      )
    ).toBe(0);
    const [capturedEvent] = capture.mock.calls[0] ?? [];
    expect(capturedEvent).toMatchObject({ event: "reservation fulfilled" });
    expect(
      Temporal.Instant.compare(
        capturedEvent?.timestamp as Temporal.Instant,
        Temporal.Instant.from(customerDeliveredPayload.created_at)
      )
    ).toBe(0);
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
  });

  test("retries invoice processing for an already fulfilled reservation", async () => {
    verifiedPayload = customerDeliveredPayload;
    const invoiceFailure = new Error("synthetic invoice failure");
    const processInvoice = mock(() => Effect.fail(invoiceFailure));
    const markFulfilled = mock(() => Effect.die("should not re-fulfill"));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(fulfilledReservation)
      ),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
    };

    const effect = await processWebhookEffect({ reservations });
    const error = await Effect.runPromise(
      Effect.flip(
        effect.pipe(
          Effect.provideService(
            ReservationInvoiceService,
            ReservationInvoiceService.of({
              processByPaymentAttemptId: processInvoice,
            })
          )
        )
      )
    );

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_invoice_processing_failed",
      workspaceReservationId: "reservation-id",
      cause: invoiceFailure,
    });
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
    expect(markFulfilled).not.toHaveBeenCalled();
  });

  test("repairs a failed delivery only for the fulfillment email failure code", async () => {
    verifiedPayload = customerDeliveredPayload;
    const markFulfilled = mock(() => Effect.succeed(fulfilledReservation));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed({
          ...awaitingDeliveryReservation,
          fulfillmentState: "failed",
          fulfillmentFailureCode: "fulfillment_email_failed",
        } as never)
      ),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not fail delivery")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({ status: "processed" });
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmailDeliveryId })
    );
  });

  test("does not repair a failed delivery with a different failure code", async () => {
    verifiedPayload = customerDeliveredPayload;
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed({
          ...awaitingDeliveryReservation,
          fulfillmentState: "failed",
          fulfillmentFailureCode: "fulfillment_dotypos_failed",
        } as never)
      ),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not repair delivery")
      ),
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not fail delivery")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "reservation_already_failed",
    });
    expect(
      reservations.markCustomerEmailDeliveryFulfilled
    ).not.toHaveBeenCalled();
  });

  test("supersedes an older fulfillment when a newer delivery failure arrives", async () => {
    verifiedPayload = customerWebhookPayload(
      "email.failed",
      "2026-01-01T12:10:00.000Z"
    );
    const failedReservation = {
      ...awaitingDeliveryReservation,
      fulfillmentState: "failed",
      fulfillmentFailureCode: "fulfillment_email_failed",
      fulfillmentFailedAt: Temporal.Instant.from("2026-01-01T12:10:00.000Z"),
    } as never;
    const markDeliveryFailed = mock(() => Effect.succeed(failedReservation));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed({
          ...fulfilledReservation,
          fulfilledAt: Temporal.Instant.from("2026-01-01T12:00:00.000Z"),
        } as never)
      ),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not update delivery")
      ),
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({ status: "processed" });
    expect(markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmailDeliveryId,
        failureCode: "fulfillment_email_failed",
        failedAt: Temporal.Instant.from("2026-01-01T12:10:00.000Z"),
      })
    );
  });

  test("does not downgrade a fulfillment with a late failure event", async () => {
    verifiedPayload = customerFailurePayload;
    const capture = mock(() => Effect.void);
    const markDeliveryFailed = mock(() => Effect.succeed(null));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed({
          ...fulfilledReservation,
          fulfilledAt: Temporal.Instant.from("2026-01-01T12:10:00.000Z"),
        } as never)
      ),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not update delivery")
      ),
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const effect = await processWebhookEffect({
      reservations,
      posthogCapture: capture,
    });
    const result = await Effect.runPromise(
      effect.pipe(
        Effect.provideService(
          ReservationInvoiceService,
          ReservationInvoiceService.of({
            processByPaymentAttemptId: () => Effect.void,
          })
        )
      )
    );

    expect(result).toEqual({
      status: "ignored",
      reason: "reservation_delivery_state_changed",
    });
    expect(markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmailDeliveryId,
        failedAt: Temporal.Instant.from(customerFailurePayload.created_at),
      })
    );
    expect(capture).not.toHaveBeenCalled();
  });

  test("cannot clear a newer delivery failure with a delayed success event", async () => {
    verifiedPayload = customerDeliveredPayload;
    const capture = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.succeed(null));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed({
          ...awaitingDeliveryReservation,
          fulfillmentState: "failed",
          fulfillmentFailureCode: "fulfillment_email_failed",
          fulfillmentFailedAt: Temporal.Instant.from(
            "2026-01-01T12:10:00.000Z"
          ),
        } as never)
      ),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not fail delivery")
      ),
    };

    const effect = await processWebhookEffect({
      reservations,
      posthogCapture: capture,
    });
    const result = await Effect.runPromise(
      effect.pipe(
        Effect.provideService(
          ReservationInvoiceService,
          ReservationInvoiceService.of({
            processByPaymentAttemptId: processInvoice,
          })
        )
      )
    );

    expect(result).toEqual({
      status: "ignored",
      reason: "reservation_delivery_state_changed",
    });
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmailDeliveryId,
        fulfilledAt: Temporal.Instant.from(customerDeliveredPayload.created_at),
      })
    );
    expect(capture).not.toHaveBeenCalled();
    expect(processInvoice).not.toHaveBeenCalled();
  });

  test("retries a customer webhook that arrives before the delivery is attached", async () => {
    verifiedPayload = customerDeliveredPayload;
    const markFulfilled = mock(() => Effect.succeed(fulfilledReservation));
    const markDeliveryFailed = mock(() =>
      Effect.die("should not update delivery")
    );
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() => Effect.succeed(null)),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const firstError = await processWebhookError({ reservations });

    expect(firstError).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_delivery_unattached",
      eventId: "webhook-event-id",
      workspaceReservationId: "reservation-id",
    });
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).toHaveBeenCalledWith(customerEmailDeliveryId);
    expect(markFulfilled).not.toHaveBeenCalled();
    expect(markDeliveryFailed).not.toHaveBeenCalled();

    const retryResult = await processWebhook({
      reservations: {
        ...reservations,
        findByActiveCustomerEmailDeliveryId: mock(() =>
          Effect.succeed(awaitingDeliveryReservation)
        ),
      },
    });

    expect(retryResult).toEqual({ status: "processed" });
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmailDeliveryId })
    );
  });

  test("ignores author confirmation webhooks, which never become the active delivery", async () => {
    verifiedPayload = authorConfirmationBouncedPayload;
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() => Effect.succeed(null)),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not update delivery")
      ),
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not update delivery")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "unknown_email_delivery",
    });
    expect(reservations.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
  });

  test("ignores webhooks for an unknown email delivery outside customer access", async () => {
    verifiedPayload = internalFailurePayload;
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() => Effect.succeed(null)),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not update delivery")
      ),
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not update delivery")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "unknown_email_delivery",
    });
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).toHaveBeenCalledWith(customerEmailDeliveryId);
    expect(
      reservations.markCustomerEmailDeliveryFulfilled
    ).not.toHaveBeenCalled();
    expect(reservations.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
  });

  test("ignores webhooks for an unknown email delivery from another deployment environment", async () => {
    verifiedPayload = {
      ...customerDeliveredPayload,
      data: {
        ...customerDeliveredPayload.data,
        tags: customerDeliveredPayload.data.tags.map((tag) =>
          tag.name === "deploymentEnvironment"
            ? { ...tag, value: "production" }
            : tag
        ),
      },
    };
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() => Effect.succeed(null)),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not update delivery")
      ),
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not update delivery")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "unknown_email_delivery",
    });
    expect(
      reservations.markCustomerEmailDeliveryFulfilled
    ).not.toHaveBeenCalled();
    expect(reservations.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
  });

  test("ignores delivery events whose reservation tag mismatches the active delivery", async () => {
    verifiedPayload = {
      ...customerDeliveredPayload,
      data: {
        ...customerDeliveredPayload.data,
        tags: customerDeliveredPayload.data.tags.map((tag) =>
          tag.name === "workspaceReservationId"
            ? { ...tag, value: "other-reservation-id" }
            : tag
        ),
      },
    };
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation)
      ),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not update delivery")
      ),
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not update delivery")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "reservation_mismatch",
    });
    expect(
      reservations.markCustomerEmailDeliveryFulfilled
    ).not.toHaveBeenCalled();
    expect(reservations.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
  });

  test("fails Resend webhook processing for invalid payloads", async () => {
    verifiedPayload = { data: { tags: [] }, type: 42 };
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("should not load reservation")
      ),
    };

    const error = await processWebhookError({
      reservations,
    });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_payload_invalid",
      eventId: "webhook-event-id",
    });
    expect(verifyWebhook).toHaveBeenCalled();
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).not.toHaveBeenCalled();
  });

  test("marks customer reservation access delivery failures failed", async () => {
    verifiedPayload = customerFailurePayload;
    const markDeliveryFailed = mock(() =>
      Effect.succeed(awaitingDeliveryReservation)
    );
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation)
      ),
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const result = await processWebhook({
      reservations,
    });

    expect(result).toEqual({ status: "processed" });
    expect(verifyWebhook).toHaveBeenCalledWith({
      payload: "raw-payload",
      headers: {
        id: "webhook-event-id",
        timestamp: "1710000000",
        signature: "v1,signature",
      },
      webhookSecret: "whsec_test",
    });
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).toHaveBeenCalledWith(customerEmailDeliveryId);

    const [failedInput] = markDeliveryFailed.mock.calls[0] ?? [];
    expect(failedInput).toMatchObject({
      customerEmailDeliveryId,
      failureCode: "fulfillment_email_failed",
    });
    expect(failedInput.failedAt).toBeInstanceOf(Temporal.Instant);
    expect(
      Temporal.Instant.compare(
        failedInput.failedAt as Temporal.Instant,
        Temporal.Instant.from(customerFailurePayload.created_at)
      )
    ).toBe(0);
  });

  test("marks bounced customer reservation access emails failed", async () => {
    verifiedPayload = customerBouncedPayload;
    const markDeliveryFailed = mock(() =>
      Effect.succeed(awaitingDeliveryReservation)
    );
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation)
      ),
      markCustomerEmailDeliveryFailed: markDeliveryFailed,
    };

    const result = await processWebhook({
      reservations,
    });

    expect(result).toEqual({ status: "processed" });
    expect(markDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmailDeliveryId,
        failureCode: "fulfillment_email_failed",
      })
    );
    const [bouncedInput] = markDeliveryFailed.mock.calls[0] ?? [];
    expect(
      Temporal.Instant.compare(
        bouncedInput?.failedAt as Temporal.Instant,
        Temporal.Instant.from(customerBouncedPayload.created_at)
      )
    ).toBe(0);
  });

  test("ignores internal notification delivery failures", async () => {
    verifiedPayload = internalFailurePayload;
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation)
      ),
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not update")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "unrelated_email",
    });
    expect(reservations.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
  });

  test("ignores delivery events from another deployment environment", async () => {
    verifiedPayload = {
      ...customerDeliveredPayload,
      data: {
        ...customerDeliveredPayload.data,
        tags: customerDeliveredPayload.data.tags.map((tag) =>
          tag.name === "deploymentEnvironment"
            ? { ...tag, value: "production" }
            : tag
        ),
      },
    };
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation)
      ),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("should not update")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "deployment_environment_mismatch",
    });
    expect(
      reservations.markCustomerEmailDeliveryFulfilled
    ).not.toHaveBeenCalled();
  });

  test("records campaign complaint events without touching reservations", async () => {
    verifiedPayload = campaignComplaintPayload;
    const recordCampaignDelivery = mock<
      ICampaignDeliveryStatusService["record"]
    >((_) => Effect.succeed({ status: "processed" }));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("campaign events must not load reservations")
      ),
      markCustomerEmailDeliveryFulfilled: mock(() =>
        Effect.die("campaign events must not update reservations")
      ),
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("campaign events must not update reservations")
      ),
    };

    const result = await processWebhook({
      reservations,
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
    for (const repositoryMethod of Object.values(reservations)) {
      expect(repositoryMethod).not.toHaveBeenCalled();
    }
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
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("campaign events must not load reservations")
      ),
    };

    const result = await processWebhook({
      reservations,
      recordCampaignDelivery,
    });

    expect(result).toEqual({
      status: "ignored",
      reason: "deployment_environment_mismatch",
    });
    expect(recordCampaignDelivery).not.toHaveBeenCalled();
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).not.toHaveBeenCalled();
  });

  test("maps campaign delivery record failures to a processing error", async () => {
    verifiedPayload = campaignComplaintPayload;
    const recordFailure = new Error("synthetic campaign record failure");
    const recordCampaignDelivery = mock<
      ICampaignDeliveryStatusService["record"]
    >(() => Effect.fail(recordFailure as never));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("campaign events must not load reservations")
      ),
    };

    const error = await processWebhookError({
      reservations,
      recordCampaignDelivery,
    });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_campaign_update_failed",
      eventId: "webhook-event-id",
      cause: recordFailure,
    });
    expect(recordCampaignDelivery).toHaveBeenCalledTimes(1);
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).not.toHaveBeenCalled();
  });
});
