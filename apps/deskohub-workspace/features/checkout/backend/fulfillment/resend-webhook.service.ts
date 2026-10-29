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
import { CampaignDeliveryStatusService } from "@/features/email-campaigns/backend/campaign-delivery-status.service";
import { campaignEmailCategory } from "@/features/email-campaigns/campaign-email-message";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  type Instant,
  instantStringSchema,
  TemporalInstantSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { ResendWebhookRuntimeConfig } from "./resend-webhook.config";
import {
  type ReservationAccessDeliveryReport,
  type ReservationDeliveryReportError,
  ReservationFulfillment,
} from "./reservation-fulfillment.service";
import { customerAccessCategory } from "./workspace-reservation-email.service";

const workspaceFulfillmentSource = "workspace-paid-fulfillment";

const ResendWebhookEventIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("ResendWebhookEventId")
).annotate({
  identifier: "ResendWebhookEventId",
  description: "Opaque identifier assigned to a Resend webhook event.",
});
export type ResendWebhookEventId = typeof ResendWebhookEventIdSchema.Type;

const ResendEmailIdSchema = EmailDeliveryIdSchema.pipe(
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
    | "resend_webhook_reservation_update_failed"
    | "resend_webhook_campaign_update_failed";
  readonly message: string;
  readonly eventId?: ResendWebhookEventId;
  readonly workspaceReservationId?: WorkspaceReservationId;
  readonly cause?: unknown;
}> {}

interface ResendWebhookProcessingResult {
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
    Layer.provide(ReservationFulfillment.Live),
    Layer.provide(CampaignDeliveryStatusService.Default),
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

// An equal tag wins over a missing one, so an untagged email still counts as
// this deployment's when the deployment itself has no environment name.
const classifyDeployment = (
  tagged: string | undefined,
  current: string
): NonNullable<
  ReservationAccessDeliveryReport["accessEmail"]
>["deployment"] => {
  if (tagged === current) return "current";
  return tagged === undefined ? "missing" : "other";
};

/** Keeps the webhook's error code and message for each unapplied report. */
const describeUnappliedReport = (
  report: ReservationAccessDeliveryReport,
  reason: ReservationDeliveryReportError["reason"]
): Pick<ResendWebhookProcessingError, "errorCode" | "message"> => {
  switch (reason) {
    case "delivery_unattached":
      return {
        errorCode: "resend_webhook_delivery_unattached",
        message:
          "Resend webhook referenced the customer delivery before it was attached to a reservation.",
      };
    case "reservation_load_failed":
      return {
        errorCode: "resend_webhook_reservation_load_failed",
        message:
          "Resend webhook could not load the reservation for the delivered email.",
      };
    case "invoice_processing_failed":
      return {
        errorCode: "resend_webhook_invoice_processing_failed",
        message: "Resend webhook invoice processing failed.",
      };
    case "reservation_update_failed":
      return {
        errorCode: "resend_webhook_reservation_update_failed",
        message:
          report.outcome === "delivered"
            ? "Resend webhook could not mark reservation fulfilled."
            : "Resend webhook could not mark reservation fulfillment failed.",
      };
  }
};

function makeResendWebhookServiceLayer(service: typeof ResendWebhookService) {
  return Layer.effect(
    service,
    Effect.gen(function* () {
      const fulfillment = yield* ReservationFulfillment;
      const config = yield* ResendWebhookRuntimeConfig;
      const campaignDeliveryStatus = yield* CampaignDeliveryStatusService;

      /**
       * Campaign emails carry their own category tag; their delivery status
       * belongs to the frozen campaign recipient, not to a reservation.
       */
      const processCampaignEvent = Effect.fn(
        "resendWebhook.processCampaignEvent"
      )(function* (input: {
        readonly eventId: ResendWebhookEventId;
        readonly event: ResendWebhookEvent;
        readonly tags: ReadonlyMap<string, string>;
      }) {
        const deploymentEnvironment = input.tags.get("deploymentEnvironment");
        if (deploymentEnvironment !== config.deploymentEnvironment) {
          return ignored(
            deploymentEnvironment === undefined
              ? "deployment_environment_missing"
              : "deployment_environment_mismatch"
          );
        }
        const providerMessageId = input.event.data.email_id;
        if (!providerMessageId) {
          return ignored("campaign_email_id_missing");
        }
        return yield* campaignDeliveryStatus
          .record({
            type: input.event.type,
            providerMessageId,
            tags: input.tags,
            occurredAt: input.event.createdAt,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ResendWebhookProcessingError({
                  errorCode: "resend_webhook_campaign_update_failed",
                  message:
                    "Resend webhook could not record the campaign delivery status.",
                  eventId: input.eventId,
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

          const eventTags = toTags(event.data.tags);
          if (eventTags.get("category") === campaignEmailCategory) {
            return yield* processCampaignEvent({
              eventId: input.eventId,
              event,
              tags: eventTags,
            });
          }

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
          const deploymentEnvironment = tags.get("deploymentEnvironment");
          const report: ReservationAccessDeliveryReport = {
            deliveryId: resendEmailId,
            outcome: isDeliverySuccessEvent(event) ? "delivered" : "failed",
            occurredAt: event.createdAt,
            ...(isCustomerAccessDelivery && {
              accessEmail: {
                reservationId: workspaceReservationId,
                deployment: classifyDeployment(
                  deploymentEnvironment,
                  config.deploymentEnvironment
                ),
              },
            }),
          };

          const outcome = yield* fulfillment.recordDelivery(report).pipe(
            Effect.mapError(
              (error) =>
                new ResendWebhookProcessingError({
                  ...describeUnappliedReport(report, error.reason),
                  eventId: input.eventId,
                  workspaceReservationId: error.workspaceReservationId,
                  cause: error.cause,
                })
            )
          );

          return outcome === "applied"
            ? ({ status: "processed" } satisfies ResendWebhookProcessingResult)
            : ignored(outcome.ignored);
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
