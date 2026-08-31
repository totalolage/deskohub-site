import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
  type EmailSendResult,
} from "@deskohub/email";
import type { EmailService } from "@deskohub/email/backend/service";
import { getQueriesForElement } from "@testing-library/react";
import { Effect, Layer, Logger } from "effect";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import { m } from "@/features/i18n";
import type { IWorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { CapturePostHogEventInput } from "@/shared/backend/analytics/posthog-event.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  workspaceLocationMapImageOptions,
  workspaceSiteConstants,
} from "@/shared/utils";
import type { ResendWebhookRuntimeConfigObj } from "./resend-webhook.config";

let verifiedPayload: unknown;

const constructResend = mock((_apiKey?: string) => undefined);

const sendEmail = mock(async () => ({
  data: { id: "resend-email-id" },
  error: null,
}));

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

const locationMapImage = Buffer.from("workspace-location-map");
const generateStaticMapImage = mock(() => Effect.succeed(locationMapImage));

mock.module("osm", () => ({
  generateStaticMapImage,
}));

mock.module("resend", () => ({
  Resend: class {
    constructor(apiKey?: string) {
      constructResend(apiKey);
    }

    emails = {
      send: sendEmail,
    };

    webhooks = {
      verify: verifyWebhook,
    };
  },
}));

const sentResult = (id: string): EmailSendResult => ({
  id: EmailDeliveryIdSchema.make(id),
  status: "sent",
  provider: "test",
  timestamp: new Date(),
});

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

const renderEmailHtml = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;

  return getQueriesForElement(container);
};

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
            Layer.succeed(ResendWebhookRuntimeConfig, config)
          )
        )
      )
    )
  );
};

describe("ResendWebhookService", () => {
  beforeEach(() => {
    process.env.EMAIL_API_KEY = "re_test";
    verifiedPayload = undefined;
    verifyWebhook.mockClear();
    sendEmail.mockClear();
    constructResend.mockClear();
    generateStaticMapImage.mockClear();
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

  test("rejects a verified delivery payload without created_at", async () => {
    verifiedPayload = {
      type: "email.delivered",
      data: customerDeliveredPayload.data,
    };
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("should not load reservation")
      ),
    };

    const error = await processWebhookError({ reservations });

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

  test("rejects a verified delivery payload with an invalid created_at", async () => {
    verifiedPayload = {
      ...customerDeliveredPayload,
      created_at: "yesterday afternoon",
    };
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("should not load reservation")
      ),
    };

    const error = await processWebhookError({ reservations });

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

  test("ignores a delivered event when the guarded transition matches no row", async () => {
    verifiedPayload = customerDeliveredPayload;
    const capture = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.succeed(null));
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.succeed(awaitingDeliveryReservation)
      ),
      markCustomerEmailDeliveryFulfilled: markFulfilled,
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
      expect.objectContaining({ customerEmailDeliveryId })
    );
    expect(capture).not.toHaveBeenCalled();
    expect(processInvoice).not.toHaveBeenCalled();
  });

  test("fails Resend webhook processing without an API key", async () => {
    verifiedPayload = customerDeliveredPayload;
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("should not load reservation")
      ),
    };

    const error = await processWebhookError({
      reservations,
      config: {
        deploymentEnvironment: "development",
        webhookSecret: "whsec_test",
      },
    });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_api_key_missing",
      eventId: "webhook-event-id",
    });
    expect(constructResend).not.toHaveBeenCalled();
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(
      reservations.findByActiveCustomerEmailDeliveryId
    ).not.toHaveBeenCalled();
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

  test("rejects an empty raw webhook event ID at the header boundary", async () => {
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("should not load reservation")
      ),
    };

    const error = await processWebhookError({
      reservations,
      request: {
        ...validRawWebhookRequest,
        headers: { ...validRawWebhookRequest.headers, id: "" },
      },
    });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_headers_missing",
    });
    expect(constructResend).not.toHaveBeenCalled();
    expect(verifyWebhook).not.toHaveBeenCalled();
  });

  test("rejects an empty raw webhook body at the payload boundary", async () => {
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("should not load reservation")
      ),
    };

    const error = await processWebhookError({
      reservations,
      request: { ...validRawWebhookRequest, payload: "" },
    });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_payload_invalid",
      eventId: "webhook-event-id",
    });
    expect(constructResend).not.toHaveBeenCalled();
    expect(verifyWebhook).not.toHaveBeenCalled();
  });

  test("rejects an empty Resend email ID in a verified delivery payload", async () => {
    verifiedPayload = {
      ...customerDeliveredPayload,
      data: { ...customerDeliveredPayload.data, email_id: "" },
    };
    const reservations = {
      findByActiveCustomerEmailDeliveryId: mock(() =>
        Effect.die("should not load reservation")
      ),
    };

    const error = await processWebhookError({ reservations });

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

  test("ignores delivery events without a deployment environment tag", async () => {
    verifiedPayload = {
      ...customerDeliveredPayload,
      data: {
        ...customerDeliveredPayload.data,
        tags: customerDeliveredPayload.data.tags.filter(
          (tag) => tag.name !== "deploymentEnvironment"
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
      markCustomerEmailDeliveryFailed: mock(() =>
        Effect.die("should not update")
      ),
    };

    const result = await processWebhook({ reservations });

    expect(result).toEqual({
      status: "ignored",
      reason: "deployment_environment_missing",
    });
    expect(
      reservations.markCustomerEmailDeliveryFulfilled
    ).not.toHaveBeenCalled();
    expect(reservations.markCustomerEmailDeliveryFailed).not.toHaveBeenCalled();
  });

  test("keeps customer fulfillment successful when internal notification fails", async () => {
    const { EmailConfigTag, EmailServiceError, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const {
      createWorkspaceCheckoutWifiQrPayload,
      WorkspaceCheckoutNetworkDetailsService,
      workspaceCheckoutPlaceholderNetworkDetails,
    } = await import("./network-details.service");
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const sentMessages: EmailMessage[] = [];
    const send = mock((message: EmailMessage) => {
      sentMessages.push(message);

      return sentMessages.length === 1
        ? Effect.succeed(sentResult("customer-email-id"))
        : Effect.fail(new EmailServiceError("Internal notification failed."));
    });
    const emailService: EmailService = {
      send,
      sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
      verify: Effect.succeed(true),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: "reservations@workspace.deskohub.cz",
        name: "Deskohub Workspace",
      },
    };
    const errorMessages: string[] = [];
    const logger = Logger.make((options) => {
      if (options.logLevel === "Error") {
        errorMessages.push(
          String(
            Array.isArray(options.message)
              ? options.message[0]
              : options.message
          )
        );
      }
    });

    await Effect.gen(function* () {
      const service = yield* WorkspaceReservationEmailService;
      return yield* service.sendPaidReservationEmails({
        reservation: {
          id: "reservation-id",
          locale: "en-US",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          dotyposReservationId: "dotypos-reservation-id",
          dotyposCustomerId: "dotypos-customer-id",
          customer: {
            _cloudId: "customer-id",
            email: "customer@example.com",
            firstName: "Ada",
            lastName: "Lovelace",
            companyName: null,
            phone: "123456789",
            points: null,
            flags: "0",
            display: true,
            deleted: false,
          },
          reservedFrom: Temporal.Instant.from("2026-06-15T22:00:00.000Z"),
          reservedUntil: Temporal.Instant.from("2026-06-16T22:00:00.000Z"),
          tableName: "12",
          tableMap: {
            assignedTableId: "desk-12",
            roomName: "Main room",
            tables: [
              {
                _cloudId: "cloud-id",
                id: "desk-12",
                name: "12",
                locationName: "Main room",
                positionX: "40",
                positionY: "80",
                type: "SQUARE",
              },
            ],
          },
        },
      });
    }).pipe(
      Effect.provide(
        WorkspaceReservationEmailService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(EmailServiceTag, emailService),
              Layer.mock(EmailConfigTag, emailConfig),
              WorkspaceCheckoutNetworkDetailsService.Default
            )
          )
        )
      ),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(errorMessages).toContain(
      "Workspace reservation internal email failed"
    );
    expect(sentMessages[0]?.tags).toEqual([
      "workspace-paid-reservation-access",
    ]);
    expect(sentMessages[1]?.tags).toEqual([
      "workspace-paid-reservation-internal",
    ]);
    expect(sentMessages[0]?.metadata).toMatchObject({
      deploymentEnvironment: "development",
      source: "workspace-paid-fulfillment",
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      dotyposReservationStartDate: "2026-06-15T22:00:00Z",
      dotyposReservationEndDate: "2026-06-16T22:00:00Z",
    });
    const customerEmail = sentMessages[0];
    if (!customerEmail) {
      throw new Error("Customer email was not sent.");
    }
    const customerHtml = customerEmail.html ?? "";
    const customerText = customerEmail.text ?? "";

    expect(customerEmail.to).toEqual({ email: "customer@example.com" });
    expect(Object.hasOwn(customerEmail.metadata ?? {}, "customerEmail")).toBe(
      false
    );
    expect(customerHtml).not.toContain("Ada");
    expect(customerHtml).not.toContain("Lovelace");
    expect(customerHtml).not.toContain("customer@example.com");
    expect(customerHtml).not.toContain("123456789");
    expect(customerText).not.toContain("Ada");
    expect(customerText).not.toContain("Lovelace");
    expect(customerText).not.toContain("customer@example.com");
    expect(customerText).not.toContain("123456789");

    registerWorkspaceComponentTestEnv();
    try {
      const emailView = renderEmailHtml(customerHtml);
      const locale = "en-US";
      const customerAccessHeadingDate = new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/Prague",
      }).format(new Date("2026-06-15T22:00:00.000Z"));
      const customerAccessHeading = m.checkoutEmailCustomerAccessHeading(
        { date: customerAccessHeadingDate },
        { locale }
      );
      const accessLink = emailView.getByRole("link", {
        name: m.checkoutEmailCustomerAccessButton({}, { locale }),
      });
      const invoiceLink = emailView.getByRole("link", {
        name: m.checkoutEmailCustomerInvoiceDownload({}, { locale }),
      });
      const accessCodeTable = accessLink.closest("table");
      const tableLabel = emailView.getByText(
        m.checkoutEmailTableNumberLabel({}, { locale })
      );
      const networkHeading = emailView.getByText(
        m.checkoutEmailNetworkHeading({}, { locale })
      );
      const networkQrImage = emailView.getByRole("img", {
        name: m.checkoutEmailNetworkHeading({}, { locale }),
      });
      const mapImage = emailView.getByRole("img", {
        name: m.checkoutEmailLocationHeading({}, { locale }),
      });
      const mapLink = emailView.getByRole("link", {
        name: m.checkoutEmailLocationMapLink({}, { locale }),
      });
      const addressLink = emailView.getByRole("link", {
        name: `${workspaceSiteConstants.location.address.street}, ${workspaceSiteConstants.location.address.postalCode} ${workspaceSiteConstants.location.address.city} - ${workspaceSiteConstants.location.address.cityDistrict}`,
      });
      const expectedMapUrl = `https://www.google.com/maps/dir/?api=1&destination=${workspaceSiteConstants.location.coordinates.lat},${workspaceSiteConstants.location.coordinates.lng}`;

      expect(emailView.getByRole("heading", { level: 1 }).textContent).toBe(
        customerAccessHeading
      );
      expect(customerText).toContain(customerAccessHeading.toUpperCase());
      expect(
        emailView.queryByText(m.reservationEmailNameLabel({}, { locale }))
      ).toBeNull();
      expect(
        emailView.queryByText(m.reservationEmailPhoneLabel({}, { locale }))
      ).toBeNull();
      expect(emailView.queryByText("Ada Lovelace")).toBeNull();
      expect(emailView.queryByText("123456789")).toBeNull();
      expect(customerHtml).not.toContain("ACCESS-123");
      expect(customerText).not.toContain("ACCESS-123");
      expect(accessLink.getAttribute("href")).toContain(
        "/en-US/reservation/access/reservation-id?accessToken="
      );
      expect(invoiceLink.getAttribute("href")).toContain(
        "/en-US/reservation/invoice/reservation-id?accessToken="
      );
      expect(accessCodeTable?.getAttribute("bgcolor")).toBe("#00024f");
      expect(accessCodeTable?.contains(accessLink)).toBe(true);
      expect(accessCodeTable?.getAttribute("style")).toContain(
        "background-color:#00024f"
      );
      expect(accessCodeTable?.textContent).toContain(
        m.checkoutEmailCustomerAccessButton({}, { locale })
      );
      expect(accessCodeTable?.contains(invoiceLink)).toBe(false);
      expect(invoiceLink.closest("tr")?.textContent).toContain(
        m.checkoutEmailCustomerInvoiceLabel({}, { locale })
      );
      expect(networkHeading).toBeTruthy();
      expect(
        emailView.getByText(workspaceCheckoutPlaceholderNetworkDetails.ssid)
      ).toBeTruthy();
      expect(
        emailView.getByText(workspaceCheckoutPlaceholderNetworkDetails.password)
      ).toBeTruthy();
      expect(networkQrImage.getAttribute("src")).toBe("cid:workspace-wifi-qr");
      expect(tableLabel.nextElementSibling?.textContent).toBe("12");
      expect(
        emailView.queryByRole("img", {
          name: m.checkoutStatusTableMapTitle({}, { locale }),
        })
      ).toBeNull();
      expect(customerHtml).not.toContain("Where to sit");
      expect(customerHtml).not.toContain("workspace-table-map");
      expect(customerText).not.toContain(
        m.checkoutStatusTableMapTitle({}, { locale })
      );
      expect(emailView.getByText("dotypos-reservation-id")).toBeTruthy();
      expect(emailView.getByText("reservation-id")).toBeTruthy();
      expect(mapImage.getAttribute("src")).toBe("cid:workspace-location-map");
      expect(addressLink.getAttribute("href")).toBe(expectedMapUrl);
      expect(mapLink.getAttribute("href")).toBe(expectedMapUrl);
      expect(customerEmail.attachments).toHaveLength(2);
      expect(customerEmail.attachments?.[0]).toMatchObject({
        contentId: "workspace-location-map",
        contentType: "image/jpeg",
        filename: "workspace-location-map.jpeg",
      });
      expect(customerEmail.attachments?.[0]?.content).toEqual(locationMapImage);
      expect(customerEmail.attachments?.[1]).toMatchObject({
        contentId: "workspace-wifi-qr",
        contentType: "image/png",
        filename: "workspace-wifi-qr.png",
      });
      const qrAttachmentContent = customerEmail.attachments?.[1]?.content;
      if (!Buffer.isBuffer(qrAttachmentContent)) {
        throw new Error("Wi-Fi QR attachment content was not a PNG buffer.");
      }
      expect(qrAttachmentContent.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(
        createWorkspaceCheckoutWifiQrPayload(
          workspaceCheckoutPlaceholderNetworkDetails
        )
      ).toBe("WIFI:T:WPA;S:Deskohub Workspace;P:Workspace42;;");
      expect(generateStaticMapImage).toHaveBeenCalledWith(
        workspaceLocationMapImageOptions
      );
    } finally {
      unregisterWorkspaceComponentTestEnv();
    }

    const internalEmail = sentMessages[1];
    if (!internalEmail) {
      throw new Error("Internal email was not sent.");
    }
    const internalLocale = "cs-CZ";
    expect(internalEmail.to).toEqual({
      email: "delivered+workspace-internal@resend.dev",
      name: workspaceSiteConstants.brand.name,
    });
    expect(internalEmail.subject).toBe(
      `[TESTING] ${m.checkoutEmailInternalPaidReservationSubject(
        { orderId: "reservation-id" },
        { locale: internalLocale }
      )}`
    );
    expect(internalEmail.html).toContain(
      m.checkoutEmailInternalPaidReservationHeading(
        {},
        { locale: internalLocale }
      )
    );
    expect(internalEmail.text).toContain(
      m
        .checkoutEmailInternalPaidReservationHeading(
          {},
          { locale: internalLocale }
        )
        .toUpperCase()
    );
    expect(internalEmail.html).toContain("customer@example.com");
    expect(internalEmail.text).toContain("customer@example.com");
    expect(internalEmail.html).not.toContain("ACCESS-123");
    expect(internalEmail.text).not.toContain("ACCESS-123");
    expect(internalEmail.html).not.toContain("/reservation/access/");
    expect(internalEmail.text).not.toContain("/reservation/access/");
    expect(internalEmail.html).not.toContain("accessToken=");
    expect(internalEmail.text).not.toContain("accessToken=");
  });

  test("completes non-production fulfillment after the email provider accepts delivery", async () => {
    const { DotyposService } = await import("@deskohub/dotypos");
    const { WorkspacePaidFulfillmentService } = await import(
      "./paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { WorkspaceCheckoutAccessCodeService } = await import(
      "@/features/checkout/backend/reservation/access-code.service"
    );
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const { WorkspaceReservationService } = await import(
      "@/features/reservation/backend/workspace-reservation.service"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const existingReservation = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimedReservation = {
      ...existingReservation,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    };
    const sendPaidReservationEmails = mock(() => Effect.void);
    const resolveCustomerAccessCode = mock(() => Effect.succeed("access-code"));
    const emailReservation = {
      ...claimedReservation,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-06-15T22:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-06-16T22:00:00.000Z"),
      tableName: "12",
    };
    const getReservation = mock(() =>
      Effect.succeed(emailReservation as never)
    );
    const workspaceReservations = {
      getReservation,
    };
    const markFulfilled = mock(() => Effect.void);
    const reservations = {
      findById: mock(() => Effect.succeed(existingReservation as never)),
      claimPaidFulfillment: mock(() =>
        Effect.succeed(claimedReservation as never)
      ),
      markFulfilled,
    };
    const dotypos = {
      confirmReservation: mock(() =>
        Effect.die("reservation is already confirmed")
      ),
    };
    const reservationEmails = {
      sendPaidReservationEmails,
    };

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      return yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(DotyposService, dotypos),
              Layer.mock(WorkspaceReservationService, workspaceReservations),
              Layer.mock(WorkspaceReservationEmailService, reservationEmails),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode,
              }),
              Layer.mock(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: () => Effect.void,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(reservations.claimPaidFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(getReservation).toHaveBeenCalledWith("reservation-id");
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
      customerEmailIdempotencyKey:
        "workspace-paid-reservation-access-reservation-id",
    });
    expect(resolveCustomerAccessCode).toHaveBeenCalledTimes(1);
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
  });

  test("Resend provider forwards webhook correlation tags", async () => {
    const { EmailConfigTag, EmailProviderTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { ResendEmailProviderLive } = await import(
      "@deskohub/email/backend/providers/resend-provider"
    );
    const emailConfig: EmailProviderConfig = {
      provider: "resend",
      apiKey: "api-key",
      defaultFrom: {
        email: "reservations@workspace.deskohub.cz",
        name: "Deskohub",
      },
    };

    const provider = await EmailProviderTag.pipe(
      Effect.provide(
        ResendEmailProviderLive.pipe(
          Layer.provide(Layer.mock(EmailConfigTag, emailConfig))
        )
      ),
      Effect.runPromise
    );

    await Effect.runPromise(
      provider.send({
        from: { email: "reservations@workspace.deskohub.cz", name: "Deskohub" },
        to: { email: "customer@example.com" },
        subject: "Reservation access",
        html: "<p>Access code</p>",
        text: "Access code",
        attachments: [
          {
            content: locationMapImage,
            contentId: "workspace-location-map",
            contentType: "image/jpeg",
            filename: "workspace-location-map.jpeg",
          },
        ],
        headers: {
          "X-Entity-Ref-ID": "reservation-id",
        },
        tags: ["workspace-paid-reservation-access", "unsafe category"],
        metadata: {
          deploymentEnvironment: "development",
          source: "workspace-paid-fulfillment",
          workspaceReservationId: "reservation-id",
          ignoredNumber: 42,
          unsafeValue: "contains spaces",
        },
      })
    );

    const [payload] = sendEmail.mock.calls[0] ?? [];
    expect(payload).toMatchObject({
      headers: {
        "X-Entity-Ref-ID": "reservation-id",
      },
      attachments: [
        {
          content: locationMapImage,
          contentId: "workspace-location-map",
          contentType: "image/jpeg",
          filename: "workspace-location-map.jpeg",
        },
      ],
      tags: [
        { name: "category", value: "workspace-paid-reservation-access" },
        { name: "deploymentEnvironment", value: "development" },
        { name: "source", value: "workspace-paid-fulfillment" },
        { name: "workspaceReservationId", value: "reservation-id" },
      ],
    });
  });
});
