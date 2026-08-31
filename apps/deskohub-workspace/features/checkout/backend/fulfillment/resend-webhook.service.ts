import { EmailDeliveryIdSchema } from "@deskohub/email";
import {
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Schema,
  SchemaGetter,
} from "effect";
import { Resend } from "resend";
import { WorkspaceDatabase } from "@/db/database.service";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import {
  type Instant,
  instantStringSchema,
  TemporalInstantSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
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

const ResendWebhookCreatedAtSchema = instantStringSchema
  .pipe(
    Schema.decodeTo(TemporalInstantSchema, {
      decode: SchemaGetter.transform((value) => Temporal.Instant.from(value)),
      encode: SchemaGetter.transform(
        (instant) => temporalInstantToIsoString(instant) as Instant
      ),
    })
  )
  .annotate({
    identifier: "ResendWebhookCreatedAt",
    description: "ISO-8601 time at which Resend created the webhook event.",
  });

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
  created_at: ResendWebhookCreatedAtSchema,
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
  readonly createdAt: Temporal.Instant;
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
        createdAt: event.created_at,
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
    | "resend_webhook_delivery_unattached"
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

export interface IResendWebhookService {
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

export class ResendWebhookService extends Context.Service<
  ResendWebhookService,
  IResendWebhookService
>()("ResendWebhookService") {
  static Default = makeResendWebhookServiceLayer(this);

  static Live = this.Default.pipe(
    Layer.provide(ResendWebhookRuntimeConfig.Default),
    Layer.provide(PostHogEventService.Live),
    Layer.provide(ReservationInvoiceService.Live),
    Layer.provide(WorkspaceReservationRepository.Default),
    Layer.provide(WorkspaceDatabase.Default)
  );
}

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

function makeResendWebhookServiceLayer(service: typeof ResendWebhookService) {
  return Layer.effect(
    service,
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
          const isCustomerAccessDelivery =
            tags.get("source") === workspaceFulfillmentSource &&
            tags.get("category") === customerAccessCategory &&
            workspaceReservationId !== undefined;
          const isThisDeploymentDelivery =
            isCustomerAccessDelivery &&
            tags.get("deploymentEnvironment") === config.deploymentEnvironment;

          const reservation = yield* reservations
            .findByActiveCustomerEmailDeliveryId(resendEmailId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new ResendWebhookProcessingError({
                    errorCode: "resend_webhook_reservation_load_failed",
                    message:
                      "Resend webhook could not load the reservation for the delivered email.",
                    eventId: input.eventId,
                    cause,
                  })
              )
            );

          if (!reservation) {
            if (isThisDeploymentDelivery) {
              yield* Effect.logWarning(
                "Resend webhook arrived before the customer delivery was attached",
                {
                  eventId: input.eventId,
                  resendEmailId,
                  workspaceReservationId,
                }
              );

              return yield* new ResendWebhookProcessingError({
                errorCode: "resend_webhook_delivery_unattached",
                message:
                  "Resend webhook referenced the customer delivery before it was attached to a reservation.",
                eventId: input.eventId,
                workspaceReservationId,
              });
            }

            yield* Effect.logWarning(
              "Resend webhook referenced an unknown customer email delivery",
              { eventId: input.eventId, resendEmailId }
            );

            return ignored("unknown_email_delivery");
          }

          if (!isCustomerAccessDelivery) {
            return ignored("unrelated_email");
          }

          if (workspaceReservationId !== reservation.id) {
            yield* Effect.logWarning(
              "Resend webhook reservation tag did not match the active delivery",
              {
                eventId: input.eventId,
                resendEmailId,
                workspaceReservationId,
              }
            );

            return ignored("reservation_mismatch");
          }

          const deploymentEnvironment = tags.get("deploymentEnvironment");
          if (deploymentEnvironment !== config.deploymentEnvironment) {
            return ignored(
              deploymentEnvironment === undefined
                ? "deployment_environment_missing"
                : "deployment_environment_mismatch"
            );
          }

          if (isDeliverySuccessEvent(event)) {
            if (reservation.fulfillmentState === "fulfilled") {
              yield* processReservationInvoice({
                eventId: input.eventId,
                reservation,
              });
              return ignored("reservation_already_fulfilled");
            }

            if (
              reservation.fulfillmentState === "failed" &&
              reservation.fulfillmentFailureCode !== fulfillmentEmailFailureCode
            ) {
              yield* Effect.logInfo(
                "Resend delivery success ignored: reservation already failed",
                {
                  eventId: input.eventId,
                  workspaceReservationId,
                  fulfillmentFailureCode: reservation.fulfillmentFailureCode,
                }
              );

              return ignored("reservation_already_failed");
            }

            const fulfilledAt = event.createdAt;
            const fulfilledReservation = yield* reservations
              .markCustomerEmailDeliveryFulfilled({
                customerEmailDeliveryId: resendEmailId,
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

            if (!fulfilledReservation) {
              yield* Effect.logInfo(
                "Resend delivery success ignored: reservation delivery state is newer or changed concurrently",
                {
                  eventId: input.eventId,
                  workspaceReservationId,
                  fulfillmentState: reservation.fulfillmentState,
                }
              );

              return ignored("reservation_delivery_state_changed");
            }

            yield* captureReservationFulfilled({
              reservation: fulfilledReservation,
              timestamp: fulfilledAt,
            }).pipe(Effect.provideService(PostHogEventService, posthogEvents));
            yield* processReservationInvoice({
              eventId: input.eventId,
              reservation: fulfilledReservation,
            });

            return {
              status: "processed",
            } satisfies ResendWebhookProcessingResult;
          }

          const failedReservation = yield* reservations
            .markCustomerEmailDeliveryFailed({
              customerEmailDeliveryId: resendEmailId,
              failureCode: fulfillmentEmailFailureCode,
              failedAt: event.createdAt,
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

          if (!failedReservation) {
            yield* Effect.logInfo(
              "Resend delivery failure ignored: reservation delivery state is newer or changed concurrently",
              {
                eventId: input.eventId,
                workspaceReservationId,
                fulfillmentState: reservation.fulfillmentState,
              }
            );

            return ignored("reservation_delivery_state_changed");
          }

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
}
