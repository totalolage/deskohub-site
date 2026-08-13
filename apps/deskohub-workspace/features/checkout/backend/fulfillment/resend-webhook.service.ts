import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Context, Data, Effect, Layer, Option, Schema } from "effect";
import { Resend } from "resend";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice";
import { ReservationInvoiceServiceLiveWithDependencies } from "@/features/accounting/backend/reservation-invoice-live.server";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  PostHogEventService,
  PostHogEventServiceLive,
} from "@/shared/backend/analytics/posthog-event.service";
import { ResendWebhookRuntimeConfigLive } from "@/shared/backend/config/resend-webhook.config";
import { captureReservationFulfilled } from "../analytics/posthog-lifecycle-events";
import { ResendWebhookRuntimeConfig } from "./resend-webhook.config";

const workspaceFulfillmentSource = "workspace-paid-fulfillment";
const customerAccessCategory = "workspace-paid-reservation-access";
const fulfillmentEmailFailureCode = "fulfillment_email_failed";

export const ResendWebhookEventIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("ResendWebhookEventId")
).annotate({
  identifier: "ResendWebhookEventId",
  description: "Opaque identifier assigned to a Resend webhook event.",
});
export type ResendWebhookEventId = typeof ResendWebhookEventIdSchema.Type;

export const ResendEmailIdSchema = EmailDeliveryIdSchema.pipe(
  Schema.brand("ResendEmailId")
).annotate({
  identifier: "ResendEmailId",
  description: "Opaque identifier assigned to an email delivery by Resend.",
});
export type ResendEmailId = typeof ResendEmailIdSchema.Type;

const ResendWebhookHeadersSchema = Schema.Struct({
  id: ResendWebhookEventIdSchema,
  timestamp: Schema.NonEmptyString,
  signature: Schema.NonEmptyString,
});

const ResendWebhookPayloadSchema = Schema.NonEmptyString.annotate({
  identifier: "ResendWebhookPayload",
  description: "Raw signed Resend webhook request payload.",
});

const ResendTagSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
});
type ResendTag = Schema.Schema.Type<typeof ResendTagSchema>;

const ResendTagsSchema = Schema.Union([
  Schema.Array(ResendTagSchema),
  Schema.Record(Schema.String, Schema.String),
]);

const ResendWebhookEventInputSchema = Schema.Struct({
  type: Schema.NonEmptyString,
  data: Schema.Struct({
    email_id: Schema.optional(ResendEmailIdSchema),
    tags: Schema.optional(ResendTagsSchema),
  }),
});

type ResendWebhookEventInput = Schema.Schema.Type<
  typeof ResendWebhookEventInputSchema
>;

interface ResendWebhookEvent {
  readonly type: string;
  readonly data: {
    readonly email_id?: ResendEmailId;
    readonly tags: readonly { readonly name: string; readonly value: string }[];
  };
}

const normalizeResendTags = (tags: ResendWebhookEventInput["data"]["tags"]) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags as readonly ResendTag[];

  return Object.entries(tags).map(([name, value]) => ({
    name,
    value,
  }));
};

const decodeResendWebhookEvent = <T>(input: T) =>
  Schema.decodeUnknownEffect(ResendWebhookEventInputSchema)(input).pipe(
    Effect.map(
      (event): ResendWebhookEvent => ({
        type: event.type,
        data: {
          email_id: event.data.email_id,
          tags: normalizeResendTags(event.data.tags),
        },
      })
    )
  );

export class ResendWebhookProcessingError extends Data.TaggedError(
  "ResendWebhookProcessingError"
)<{
  readonly errorCode:
    | "resend_webhook_headers_missing"
    | "resend_webhook_api_key_missing"
    | "resend_webhook_secret_missing"
    | "resend_webhook_verification_failed"
    | "resend_webhook_payload_invalid"
    | "resend_webhook_reservation_load_failed"
    | "resend_webhook_invoice_processing_failed"
    | "resend_webhook_reservation_update_failed";
  readonly message: string;
  readonly eventId?: ResendWebhookEventId;
  readonly workspaceReservationId?: WorkspaceReservationId;
  readonly cause?: unknown;
}> {}

export interface ResendWebhookProcessingResult {
  readonly status: "processed" | "ignored";
  readonly reason?: string;
}

export interface ResendWebhookService {
  readonly processWebhook: (input: {
    readonly payload: string;
    readonly headers: {
      readonly id?: string | null;
      readonly timestamp?: string | null;
      readonly signature?: string | null;
    };
  }) => Effect.Effect<
    ResendWebhookProcessingResult,
    ResendWebhookProcessingError
  >;
}

export const ResendWebhookService = Context.Service<ResendWebhookService>(
  "ResendWebhookService"
);

const toTags = (tags: readonly { name: string; value: string }[]) =>
  new Map(tags.map((tag) => [tag.name, tag.value]));

const ignored = (reason: string): ResendWebhookProcessingResult => ({
  status: "ignored",
  reason,
});

const isDeliveryFailureEvent = (event: ResendWebhookEvent) =>
  event.type === "email.failed" || event.type === "email.bounced";

const isDeliverySuccessEvent = (event: ResendWebhookEvent) =>
  event.type === "email.delivered";

const isReservationDeliveryEvent = (event: ResendWebhookEvent) =>
  isDeliveryFailureEvent(event) || isDeliverySuccessEvent(event);

export const ResendWebhookServiceLive = Layer.effect(
  ResendWebhookService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const config = yield* ResendWebhookRuntimeConfig;
    const posthogEvents = yield* PostHogEventService;
    const reservationInvoices = yield* ReservationInvoiceService;

    const processReservationInvoice = Effect.fn(
      "resendWebhook.processReservationInvoice"
    )(function* (input: {
      readonly eventId: ResendWebhookEventId;
      readonly reservation: Pick<
        WorkspaceReservation,
        "activePaymentAttemptId" | "id"
      >;
    }) {
      if (!input.reservation.activePaymentAttemptId) {
        yield* Effect.logWarning(
          "Reservation invoice processing skipped: payment attempt missing",
          { workspaceReservationId: input.reservation.id }
        );
        return;
      }

      yield* reservationInvoices
        .processByPaymentAttemptId({
          paymentAttemptId: input.reservation.activePaymentAttemptId,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ResendWebhookProcessingError({
                errorCode: "resend_webhook_invoice_processing_failed",
                message: "Resend webhook invoice processing failed.",
                eventId: input.eventId,
                workspaceReservationId: input.reservation.id,
                cause,
              })
          )
        );
    });

    const processVerifiedEvent = Effect.fn(
      "resendWebhook.processVerifiedEvent"
    )(
      function* <T>(input: {
        readonly eventId: ResendWebhookEventId;
        readonly event: T;
      }) {
        const event = yield* decodeResendWebhookEvent(input.event).pipe(
          Effect.mapError(
            (cause) =>
              new ResendWebhookProcessingError({
                errorCode: "resend_webhook_payload_invalid",
                message: "Resend webhook payload was invalid.",
                eventId: input.eventId,
                cause,
              })
          )
        );
        yield* Effect.annotateLogsScoped({
          eventId: input.eventId,
          eventType: event.type,
        });

        if (!isReservationDeliveryEvent(event)) {
          return ignored("non_delivery_event");
        }

        const resendEmailId = event.data.email_id;
        if (!resendEmailId) {
          return yield* new ResendWebhookProcessingError({
            errorCode: "resend_webhook_payload_invalid",
            message: "Resend delivery webhook payload omitted its email ID.",
            eventId: input.eventId,
          });
        }
        yield* Effect.annotateLogsScoped({ resendEmailId });

        const tags = toTags(event.data.tags);
        const workspaceReservationId = Option.getOrUndefined(
          Schema.decodeUnknownOption(workspaceReservationIdSchema)(
            tags.get("workspaceReservationId")
          )
        );

        if (
          tags.get("source") !== workspaceFulfillmentSource ||
          tags.get("category") !== customerAccessCategory ||
          !workspaceReservationId
        ) {
          return ignored("unrelated_email");
        }

        const deploymentEnvironment = tags.get("deploymentEnvironment");
        if (
          deploymentEnvironment &&
          deploymentEnvironment !== config.deploymentEnvironment
        ) {
          return ignored("deployment_environment_mismatch");
        }

        const reservation = yield* reservations
          .findById(workspaceReservationId)
          .pipe(
            Effect.mapError(
              (cause) =>
                new ResendWebhookProcessingError({
                  errorCode: "resend_webhook_reservation_load_failed",
                  message:
                    "Resend webhook could not load referenced reservation.",
                  eventId: input.eventId,
                  workspaceReservationId,
                  cause,
                })
            )
          );

        if (!reservation) {
          yield* Effect.logWarning(
            "Resend webhook referenced unknown workspace reservation",
            { eventId: input.eventId, workspaceReservationId }
          );

          return ignored("reservation_not_found");
        }

        if (reservation.paymentState !== "paid") {
          return ignored("reservation_not_paid");
        }

        if (isDeliverySuccessEvent(event)) {
          if (reservation.fulfillmentState === "fulfilled") {
            yield* processReservationInvoice({
              eventId: input.eventId,
              reservation,
            });
            return ignored("reservation_already_fulfilled");
          }

          if (reservation.fulfillmentState === "failed") {
            yield* Effect.logInfo(
              "Resend delivery success ignored: reservation already failed",
              { eventId: input.eventId, workspaceReservationId }
            );

            return ignored("reservation_already_failed");
          }

          if (reservation.fulfillmentState !== "processing") {
            yield* Effect.logInfo(
              "Resend delivery success ignored: reservation not processing",
              {
                eventId: input.eventId,
                workspaceReservationId,
                fulfillmentState: reservation.fulfillmentState,
              }
            );

            return ignored("reservation_not_processing");
          }

          const fulfilledAt = Temporal.Now.instant();
          yield* reservations
            .markFulfilled({
              id: workspaceReservationId,
              fulfilledAt,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ResendWebhookProcessingError({
                    errorCode: "resend_webhook_reservation_update_failed",
                    message:
                      "Resend webhook could not mark reservation fulfilled.",
                    eventId: input.eventId,
                    workspaceReservationId,
                    cause,
                  })
              )
            );
          yield* captureReservationFulfilled({
            reservation,
            timestamp: fulfilledAt,
          }).pipe(Effect.provideService(PostHogEventService, posthogEvents));
          yield* processReservationInvoice({
            eventId: input.eventId,
            reservation,
          });

          return {
            status: "processed",
          } satisfies ResendWebhookProcessingResult;
        }

        if (reservation.fulfillmentState === "failed") {
          return ignored("reservation_already_failed");
        }

        if (
          reservation.fulfillmentState !== "processing" &&
          reservation.fulfillmentState !== "fulfilled"
        ) {
          return ignored("reservation_not_fulfillable");
        }

        yield* reservations
          .markFulfillmentDeliveryFailed({
            id: workspaceReservationId,
            failureCode: fulfillmentEmailFailureCode,
            failedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ResendWebhookProcessingError({
                  errorCode: "resend_webhook_reservation_update_failed",
                  message:
                    "Resend webhook could not mark reservation fulfillment failed.",
                  eventId: input.eventId,
                  workspaceReservationId,
                  cause,
                })
            )
          );

        return {
          status: "processed",
        } satisfies ResendWebhookProcessingResult;
      },
      (effect) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({ operation: "resendWebhook" })
        )
    );

    return ResendWebhookService.of({
      processWebhook: Effect.fn("resendWebhook.processWebhook")(
        function* (input) {
          const headers = yield* Schema.decodeUnknownEffect(
            ResendWebhookHeadersSchema
          )(input.headers).pipe(
            Effect.mapError(
              (cause) =>
                new ResendWebhookProcessingError({
                  errorCode: "resend_webhook_headers_missing",
                  message:
                    "Resend webhook signature headers are missing or invalid.",
                  cause,
                })
            )
          );
          const payload = yield* Schema.decodeUnknownEffect(
            ResendWebhookPayloadSchema
          )(input.payload).pipe(
            Effect.mapError(
              (cause) =>
                new ResendWebhookProcessingError({
                  errorCode: "resend_webhook_payload_invalid",
                  message: "Resend webhook request body was invalid.",
                  eventId: headers.id,
                  cause,
                })
            )
          );

          const webhookSecret = config.webhookSecret;
          const apiKey = config.apiKey;

          if (!webhookSecret) {
            return yield* new ResendWebhookProcessingError({
              errorCode: "resend_webhook_secret_missing",
              message: "RESEND_WEBHOOK_SECRET is not configured.",
              eventId: headers.id,
            });
          }

          if (!apiKey) {
            return yield* new ResendWebhookProcessingError({
              errorCode: "resend_webhook_api_key_missing",
              message: "EMAIL_API_KEY is not configured.",
              eventId: headers.id,
            });
          }

          const resend = new Resend(apiKey);

          const verifiedPayload = yield* Effect.try({
            try: () =>
              resend.webhooks.verify({
                payload,
                headers,
                webhookSecret,
              }),
            catch: (cause) =>
              new ResendWebhookProcessingError({
                errorCode: "resend_webhook_verification_failed",
                message: "Resend webhook signature verification failed.",
                eventId: headers.id,
                cause,
              }),
          });

          return yield* processVerifiedEvent({
            eventId: headers.id,
            event: verifiedPayload,
          });
        },
        (effect) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({ operation: "resendWebhook" })
          )
      ),
    });
  })
);

export const ResendWebhookServiceLiveWithDependencies =
  ResendWebhookServiceLive.pipe(
    Layer.provide(ResendWebhookRuntimeConfigLive),
    Layer.provide(PostHogEventServiceLive),
    Layer.provide(ReservationInvoiceServiceLiveWithDependencies),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive)
  );
