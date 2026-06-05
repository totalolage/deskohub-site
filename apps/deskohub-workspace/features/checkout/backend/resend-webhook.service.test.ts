import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  EmailMessage,
  EmailProviderConfig,
  EmailSendResult,
} from "@deskohub/email";
import type { EmailService } from "@deskohub/email/backend/service";
import { Effect, Layer } from "effect";
import type { OperationalEventRepository as OperationalEventRepositoryType } from "./operational-event.repository";
import type { ResendWebhookRuntimeConfigObj } from "./resend-webhook.config";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "./workspace-reservation.repository";

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
  id,
  status: "sent",
  provider: "test",
  timestamp: new Date(),
});

const customerWebhookPayload = (
  type: "email.delivered" | "email.failed" | "email.bounced"
) => ({
  type,
  data: {
    email_id: "resend-email-id",
    tags: [
      { name: "source", value: "workspace-paid-fulfillment" },
      { name: "category", value: "workspace-paid-reservation-access" },
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
  data: {
    email_id: "resend-email-id",
    tags: [
      { name: "source", value: "workspace-paid-fulfillment" },
      { name: "category", value: "workspace-paid-reservation-internal" },
      { name: "workspaceReservationId", value: "reservation-id" },
    ],
  },
};

const processWebhook = async (input: {
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly operationalEvents: OperationalEventRepositoryType;
  readonly config?: ResendWebhookRuntimeConfigObj;
}) => {
  const effect = await processWebhookEffect(input);
  return Effect.runPromise(effect);
};

const processWebhookError = async (input: {
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly operationalEvents: OperationalEventRepositoryType;
  readonly config?: ResendWebhookRuntimeConfigObj;
}) => {
  const effect = await processWebhookEffect(input);
  return Effect.runPromise(Effect.flip(effect));
};

const processWebhookEffect = async (input: {
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly operationalEvents: OperationalEventRepositoryType;
  readonly config?: ResendWebhookRuntimeConfigObj;
}) => {
  const { ResendWebhookService, ResendWebhookServiceLive } = await import(
    "./resend-webhook.service"
  );
  const { ResendWebhookRuntimeConfig } = await import(
    "./resend-webhook.config"
  );
  const { OperationalEventRepository } = await import(
    "./operational-event.repository"
  );
  const { WorkspaceReservationRepository } = await import(
    "./workspace-reservation.repository"
  );

  const config = input.config ?? {
    apiKey: "re_test",
    webhookSecret: "whsec_test",
  };

  return Effect.gen(function* () {
    const service = yield* ResendWebhookService;
    return yield* service.processWebhook({
      payload: "raw-payload",
      headers: {
        id: "webhook-event-id",
        timestamp: "1710000000",
        signature: "v1,signature",
      },
    });
  }).pipe(
    Effect.provide(ResendWebhookServiceLive),
    Effect.provide(
      Layer.succeed(WorkspaceReservationRepository, input.reservations)
    ),
    Effect.provide(
      Layer.succeed(OperationalEventRepository, input.operationalEvents)
    ),
    Effect.provide(Layer.succeed(ResendWebhookRuntimeConfig, config))
  );
};

describe("ResendWebhookService", () => {
  beforeEach(() => {
    process.env.EMAIL_API_KEY = "re_test";
    verifiedPayload = undefined;
    verifyWebhook.mockClear();
    sendEmail.mockClear();
    constructResend.mockClear();
  });

  test("marks delivered customer reservation access emails fulfilled", async () => {
    verifiedPayload = customerDeliveredPayload;
    const record = mock(() => Effect.die("should not record a failure"));
    const markFulfilled = mock(() => Effect.void);
    const markFulfillmentDeliveryFailed = mock(() =>
      Effect.die("should not fail fulfillment")
    );
    const reservations = {
      findById: mock(() =>
        Effect.succeed({
          id: "reservation-id",
          paymentState: "paid",
          fulfillmentState: "processing",
        } as never)
      ),
      markFulfilled,
      markFulfillmentDeliveryFailed,
    } as unknown as WorkspaceReservationRepositoryType;

    const result = await processWebhook({
      reservations,
      operationalEvents: {
        record,
      } as unknown as OperationalEventRepositoryType,
    });

    expect(result).toEqual({ status: "processed" });
    expect(constructResend).toHaveBeenCalledWith("re_test");
    expect(reservations.findById).toHaveBeenCalledWith("reservation-id");
    expect(record).not.toHaveBeenCalled();
    expect(markFulfillmentDeliveryFailed).not.toHaveBeenCalled();

    const [updateInput] = markFulfilled.mock.calls[0] ?? [];
    expect(updateInput).toMatchObject({ id: "reservation-id" });
    expect(updateInput.fulfilledAt).toBeInstanceOf(Date);
  });

  test("fails Resend webhook processing without an API key", async () => {
    verifiedPayload = customerDeliveredPayload;
    const reservations = {
      findById: mock(() => Effect.die("should not load reservation")),
    } as unknown as WorkspaceReservationRepositoryType;
    const operationalEvents = {
      record: mock(() => Effect.die("should not record")),
    } as unknown as OperationalEventRepositoryType;

    const error = await processWebhookError({
      reservations,
      operationalEvents,
      config: { webhookSecret: "whsec_test" },
    });

    expect(error).toMatchObject({
      _tag: "ResendWebhookProcessingError",
      errorCode: "resend_webhook_api_key_missing",
      eventId: "webhook-event-id",
    });
    expect(constructResend).not.toHaveBeenCalled();
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(reservations.findById).not.toHaveBeenCalled();
    expect(operationalEvents.record).not.toHaveBeenCalled();
  });

  test("marks customer reservation access delivery failures failed", async () => {
    verifiedPayload = customerFailurePayload;
    const record = mock(() => Effect.succeed({} as never));
    const markFulfillmentDeliveryFailed = mock(() => Effect.void);
    const reservations = {
      findById: mock(() =>
        Effect.succeed({
          id: "reservation-id",
          paymentState: "paid",
          fulfillmentState: "fulfilled",
        } as never)
      ),
      markFulfillmentDeliveryFailed,
    } as unknown as WorkspaceReservationRepositoryType;

    const result = await processWebhook({
      reservations,
      operationalEvents: {
        record,
      } as unknown as OperationalEventRepositoryType,
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
    expect(reservations.findById).toHaveBeenCalledWith("reservation-id");
    expect(record).toHaveBeenCalledWith({
      workspaceReservationId: "reservation-id",
      eventType: "workspace_paid_fulfillment_email_failed",
      severity: "error",
      failureCode: "fulfillment_email_failed",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      webhookEventId: "webhook-event-id",
    });

    const [updateInput] = markFulfillmentDeliveryFailed.mock.calls[0] ?? [];
    expect(updateInput).toMatchObject({
      id: "reservation-id",
      failureCode: "fulfillment_email_failed",
    });
    expect(updateInput.failedAt).toBeInstanceOf(Date);
  });

  test("marks bounced customer reservation access emails failed", async () => {
    verifiedPayload = customerBouncedPayload;
    const record = mock(() => Effect.succeed({} as never));
    const markFulfillmentDeliveryFailed = mock(() => Effect.void);
    const reservations = {
      findById: mock(() =>
        Effect.succeed({
          id: "reservation-id",
          paymentState: "paid",
          fulfillmentState: "processing",
        } as never)
      ),
      markFulfillmentDeliveryFailed,
    } as unknown as WorkspaceReservationRepositoryType;

    const result = await processWebhook({
      reservations,
      operationalEvents: {
        record,
      } as unknown as OperationalEventRepositoryType,
    });

    expect(result).toEqual({ status: "processed" });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceReservationId: "reservation-id",
        eventType: "workspace_paid_fulfillment_email_failed",
        failureCode: "fulfillment_email_failed",
      })
    );
    expect(markFulfillmentDeliveryFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "fulfillment_email_failed",
      })
    );
  });

  test("ignores internal notification delivery failures", async () => {
    verifiedPayload = internalFailurePayload;
    const reservations = {
      findById: mock(() => Effect.die("should not load reservation")),
      markFulfillmentDeliveryFailed: mock(() =>
        Effect.die("should not update")
      ),
    } as unknown as WorkspaceReservationRepositoryType;
    const operationalEvents = {
      record: mock(() => Effect.die("should not record")),
    } as unknown as OperationalEventRepositoryType;

    const result = await processWebhook({ reservations, operationalEvents });

    expect(result).toEqual({
      status: "ignored",
      reason: "unrelated_email",
    });
    expect(reservations.findById).not.toHaveBeenCalled();
    expect(reservations.markFulfillmentDeliveryFailed).not.toHaveBeenCalled();
    expect(operationalEvents.record).not.toHaveBeenCalled();
  });
  test("keeps customer fulfillment successful when internal notification fails", async () => {
    const { EmailConfigTag, EmailServiceError, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const {
      WorkspaceReservationEmailService,
      WorkspaceReservationEmailServiceLive,
    } = await import("./workspace-reservation-email.service");
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
      verify: mock(() => Effect.succeed(true)),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: "reservations@workspace.deskohub.cz",
        name: "Deskohub Workspace",
      },
    };

    await Effect.gen(function* () {
      const service = yield* WorkspaceReservationEmailService;
      return yield* service.sendPaidReservationEmails({
        reservation: {
          id: "reservation-id",
          locale: "cs-CZ",
          productTier: "test-tier",
          productCoffee: false,
          productMonitorOption: null,
          dotyposReservationId: "dotypos-reservation-id",
          dotyposCustomerId: "dotypos-customer-id",
          customerAccessCode: "ACCESS-123",
          reservationCreatedAt: new Date("2026-06-05T08:00:00.000Z"),
          createdAt: new Date("2026-06-05T08:00:00.000Z"),
        } as never,
        customer: {
          email: "customer@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          companyName: null,
          phone: "123456789",
        } as never,
      });
    }).pipe(
      Effect.provide(WorkspaceReservationEmailServiceLive),
      Effect.provide(Layer.succeed(EmailServiceTag, emailService)),
      Effect.provide(Layer.succeed(EmailConfigTag, emailConfig)),
      Effect.runPromise
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(sentMessages[0]?.tags).toEqual([
      "workspace-paid-reservation-access",
    ]);
    expect(sentMessages[1]?.tags).toEqual([
      "workspace-paid-reservation-internal",
    ]);
    expect(sentMessages[0]?.metadata).toMatchObject({
      source: "workspace-paid-fulfillment",
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    });
  });

  test("leaves paid fulfillment processing until Resend confirms delivery", async () => {
    const { DotyposService } = await import("@deskohub/dotypos");
    const { OperationalEventRepository } = await import(
      "./operational-event.repository"
    );
    const {
      WorkspacePaidFulfillmentService,
      WorkspacePaidFulfillmentServiceLive,
    } = await import("./paid-fulfillment.service");
    const { WorkspaceReservationRepository } = await import(
      "./workspace-reservation.repository"
    );
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const existingReservation = {
      id: "reservation-id",
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
    const markFulfilled = mock(() =>
      Effect.die("delivery webhook should mark fulfilled")
    );
    const reservations = {
      findById: mock(() => Effect.succeed(existingReservation as never)),
      claimPaidFulfillment: mock(() =>
        Effect.succeed(claimedReservation as never)
      ),
      markFulfilled,
    } as unknown as WorkspaceReservationRepositoryType;
    const dotypos = {
      getCustomer: mock(() =>
        Effect.succeed({ email: "customer@example.com" } as never)
      ),
      confirmReservation: mock(() =>
        Effect.die("reservation is already confirmed")
      ),
    } as unknown as typeof DotyposService.Service;
    const reservationEmails = {
      sendPaidReservationEmails,
    };
    const operationalEvents = {
      record: mock(() => Effect.die("should not record a failure")),
    } as unknown as OperationalEventRepositoryType;

    await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      return yield* service.fulfillPaidOrder({ orderId: "reservation-id" });
    }).pipe(
      Effect.provide(WorkspacePaidFulfillmentServiceLive),
      Effect.provide(
        Layer.succeed(WorkspaceReservationRepository, reservations)
      ),
      Effect.provide(
        Layer.succeed(OperationalEventRepository, operationalEvents)
      ),
      Effect.provide(Layer.succeed(DotyposService, dotypos)),
      Effect.provide(
        Layer.succeed(WorkspaceReservationEmailService, reservationEmails)
      ),
      Effect.runPromise
    );

    expect(reservations.claimPaidFulfillment).toHaveBeenCalledWith(
      "reservation-id"
    );
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: claimedReservation,
      customer: { email: "customer@example.com" },
    });
    expect(markFulfilled).not.toHaveBeenCalled();
    expect(operationalEvents.record).not.toHaveBeenCalled();
  });

  test("Resend provider forwards webhook correlation tags", async () => {
    const { EmailProviderTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { ResendEmailProviderLive } = await import(
      "@deskohub/email/backend/providers/resend-provider"
    );

    const provider = await Effect.gen(function* () {
      return yield* EmailProviderTag;
    }).pipe(Effect.provide(ResendEmailProviderLive), Effect.runPromise);

    await Effect.runPromise(
      provider.send({
        from: { email: "reservations@workspace.deskohub.cz", name: "Deskohub" },
        to: { email: "customer@example.com" },
        subject: "Reservation access",
        html: "<p>Access code</p>",
        text: "Access code",
        headers: {
          "X-Entity-Ref-ID": "reservation-id",
        },
        tags: ["workspace-paid-reservation-access", "unsafe category"],
        metadata: {
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
      tags: [
        { name: "category", value: "workspace-paid-reservation-access" },
        { name: "source", value: "workspace-paid-fulfillment" },
        { name: "workspaceReservationId", value: "reservation-id" },
      ],
    });
  });
});
