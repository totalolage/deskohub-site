import { EmailDeliveryIdSchema } from "@deskohub/email";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Data, Effect, Option, Schema, SchemaGetter } from "effect";
import { Resend } from "resend";
import {
  type Instant,
  instantStringSchema,
  TemporalInstantSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import type { EmailDeployment, EmailKind } from "./email-kind";
import { ResendWebhookConfig } from "./resend-webhook.config";

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

const ResendWebhookEventSchema = Schema.Struct({
  type: Schema.NonEmptyString,
  created_at: ResendWebhookCreatedAtSchema,
  data: Schema.Struct({
    email_id: Schema.optional(ResendEmailIdSchema),
    tags: Schema.optional(ResendTagsSchema),
  }),
});

type ResendTags = (typeof ResendWebhookEventSchema.Type)["data"]["tags"];

const tagMap = (tags: ResendTags): ReadonlyMap<string, string> => {
  if (!tags) return new Map();
  if (Array.isArray(tags)) {
    return new Map(
      (tags as readonly ResendTag[]).map((tag) => [tag.name, tag.value])
    );
  }
  return new Map(Object.entries(tags));
};

const categoryTag = "category";
const deploymentTag = "deploymentEnvironment" satisfies keyof EmailDeployment;

/** The Resend events a delivery report handler can consume. */
export type DeliveryReportEvent =
  | "email.delivered"
  | "email.failed"
  | "email.bounced"
  | "email.complained";

/** One verified provider report about an email of a handler's kind. */
export interface DeliveryReport<Metadata, Event extends DeliveryReportEvent> {
  readonly emailId: ResendEmailId;
  readonly event: Event;
  /** The provider's event time. */
  readonly occurredAt: Temporal.Instant;
  /** The kind's metadata; none when the email's tags don't carry it. */
  readonly metadata: Option.Option<Metadata>;
}

/** What the webhook answers for a report it accepted. */
export type DeliveryReportOutcome =
  | { readonly status: "processed" }
  | { readonly status: "ignored"; readonly reason: string };

export const processedDeliveryReport: DeliveryReportOutcome = {
  status: "processed",
};

export const ignoredDeliveryReport = (
  reason: string
): DeliveryReportOutcome => ({ status: "ignored", reason });

/**
 * A webhook request that could not be verified or read, or whose ingress
 * configuration is missing.
 */
export class DeliveryRequestError extends Data.TaggedError(
  "DeliveryRequestError"
)<{
  readonly errorCode:
    | "resend_webhook_headers_missing"
    | "resend_webhook_api_key_missing"
    | "resend_webhook_secret_missing"
    | "resend_webhook_verification_failed"
    | "resend_webhook_payload_invalid";
  readonly message: string;
  readonly eventId?: ResendWebhookEventId;
  readonly cause?: unknown;
}> {}

/** A verified report its handler could not apply yet. */
export class DeliveryReportError extends Data.TaggedError(
  "DeliveryReportError"
)<{
  /** The handler's stable code for the response and logs. */
  readonly errorCode: string;
  readonly message: string;
  /** Set by the ingress from the webhook request. */
  readonly eventId?: ResendWebhookEventId;
  /** Delivery identifiers for the logs, never payload data. */
  readonly details?: Readonly<Record<string, string | undefined>>;
  readonly cause?: unknown;
}> {}

/** A verified report before its handler narrows it. */
interface VerifiedReport {
  readonly eventId: ResendWebhookEventId;
  readonly event: string;
  readonly emailId: ResendEmailId | undefined;
  readonly occurredAt: Temporal.Instant;
  readonly tags: ReadonlyMap<string, string>;
  /** This deployment's environment. */
  readonly deploymentEnvironment: string;
}

/** Applies the delivery reports of one email kind. */
export interface DeliveryReportHandler<R> {
  readonly category: string;
  readonly receive: (
    report: VerifiedReport
  ) => Effect.Effect<
    DeliveryReportOutcome,
    DeliveryRequestError | DeliveryReportError,
    R
  >;
}

/** The ignore of a report about another deployment's email, if it is one. */
const otherDeploymentIgnore = (
  report: VerifiedReport
): Option.Option<DeliveryReportOutcome> => {
  const tagged = report.tags.get(deploymentTag);
  if (tagged === report.deploymentEnvironment) return Option.none();
  return Option.some(
    ignoredDeliveryReport(
      tagged === undefined
        ? "deployment_environment_missing"
        : "deployment_environment_mismatch"
    )
  );
};

const decodeMetadata = <Metadata>(
  kind: EmailKind<Metadata>,
  tags: ReadonlyMap<string, string>
) =>
  Option.fromUndefinedOr(
    decodeStandardSchema(kind.metadata, Object.fromEntries(tags))
  );

/** The handler's errors with the webhook event ID they answer. */
const withEventId =
  (eventId: ResendWebhookEventId) => (error: DeliveryReportError) =>
    new DeliveryReportError({
      errorCode: error.errorCode,
      message: error.message,
      eventId,
      details: error.details,
      cause: error.cause,
    });

const consumedBy =
  <Event extends DeliveryReportEvent>(events: readonly Event[]) =>
  (event: string): event is Event =>
    (events as readonly string[]).includes(event);

/**
 * The handler of `kind`'s delivery reports for `events`. The ingress ignores
 * the kind's other events as `non_delivery_event`, then rejects a report
 * without an email ID, then ignores another deployment's report. `handle`
 * sees each report with the kind's metadata decoded from the email's tags.
 */
export const deliveryReportHandler = <
  Metadata,
  const Event extends DeliveryReportEvent,
  R,
>(
  kind: EmailKind<Metadata>,
  events: readonly Event[],
  handle: (
    report: DeliveryReport<Metadata, Event>
  ) => Effect.Effect<DeliveryReportOutcome, DeliveryReportError, R>
): DeliveryReportHandler<R> => {
  const consumes = consumedBy(events);

  return {
    category: kind.category,
    receive: Effect.fnUntraced(function* (report) {
      const { event, emailId } = report;
      if (!consumes(event)) {
        return ignoredDeliveryReport("non_delivery_event");
      }
      if (!emailId) {
        return yield* new DeliveryRequestError({
          errorCode: "resend_webhook_payload_invalid",
          message: "Resend delivery webhook payload omitted its email ID.",
          eventId: report.eventId,
        });
      }
      const ignored = otherDeploymentIgnore(report);
      if (Option.isSome(ignored)) return ignored.value;

      return yield* handle({
        emailId,
        event,
        occurredAt: report.occurredAt,
        metadata: decodeMetadata(kind, report.tags),
      }).pipe(Effect.mapError(withEventId(report.eventId)));
    }),
  };
};

/** A report its handler answers itself, whatever its event. */
export interface UnfilteredDeliveryReport<
  Metadata,
  Event extends DeliveryReportEvent,
> {
  readonly emailId: Option.Option<ResendEmailId>;
  /** The event when the handler consumes it; none for the kind's others. */
  readonly event: Option.Option<Event>;
  readonly occurredAt: Temporal.Instant;
  readonly metadata: Option.Option<Metadata>;
}

/**
 * The handler of `kind`'s delivery reports that answers the kind's other
 * events and a missing email ID itself, inside `span`, which opens before the
 * deployment check.
 */
export const deliveryReportHandlerOwningIgnores = <
  Metadata,
  const Event extends DeliveryReportEvent,
  R,
>(
  kind: EmailKind<Metadata>,
  events: readonly Event[],
  span: string,
  handle: (
    report: UnfilteredDeliveryReport<Metadata, Event>
  ) => Effect.Effect<DeliveryReportOutcome, DeliveryReportError, R>
): DeliveryReportHandler<R> => {
  const consumes = consumedBy(events);

  return {
    category: kind.category,
    receive: (report) =>
      Option.match(otherDeploymentIgnore(report), {
        onSome: (ignored) => Effect.succeed(ignored),
        onNone: () =>
          handle({
            emailId: Option.fromUndefinedOr(report.emailId),
            event: Option.liftPredicate(report.event, consumes),
            occurredAt: report.occurredAt,
            metadata: decodeMetadata(kind, report.tags),
          }).pipe(Effect.mapError(withEventId(report.eventId))),
      }).pipe(Effect.withSpan(span)),
  };
};

/**
 * Ingests one Resend webhook request: verifies its Svix signature, ignores
 * reports about another deployment's emails, and hands the rest to the
 * handler of the email's `category`. Kinds without a handler are ignored.
 */
export const ingestDeliveryReport = Effect.fn("processResendWebhookRequest")(
  function* <R>(
    request: Request,
    handlers: readonly DeliveryReportHandler<R>[]
  ) {
    const payload = yield* Effect.tryPromise({
      try: () => request.text(),
      catch: (cause) =>
        new DeliveryRequestError({
          errorCode: "resend_webhook_payload_invalid",
          message: "Resend webhook request body could not be read.",
          cause,
        }),
    });

    return yield* processWebhook(
      {
        payload,
        headers: {
          id: request.headers.get("svix-id"),
          timestamp: request.headers.get("svix-timestamp"),
          signature: request.headers.get("svix-signature"),
        },
      },
      handlers
    );
  },
  Effect.scoped
);

const processWebhook = Effect.fn("resendWebhook.processWebhook")(
  function* <R>(
    input: {
      readonly payload: string;
      readonly headers: {
        readonly id: string | null;
        readonly timestamp: string | null;
        readonly signature: string | null;
      };
    },
    handlers: readonly DeliveryReportHandler<R>[]
  ) {
    const config = yield* ResendWebhookConfig;
    const headers = yield* Schema.decodeUnknownEffect(
      ResendWebhookHeadersSchema
    )(input.headers).pipe(
      Effect.mapError(
        (cause) =>
          new DeliveryRequestError({
            errorCode: "resend_webhook_headers_missing",
            message: "Resend webhook signature headers are missing or invalid.",
            cause,
          })
      )
    );
    const payload = yield* Schema.decodeUnknownEffect(
      ResendWebhookPayloadSchema
    )(input.payload).pipe(
      Effect.mapError(
        (cause) =>
          new DeliveryRequestError({
            errorCode: "resend_webhook_payload_invalid",
            message: "Resend webhook request body was invalid.",
            eventId: headers.id,
            cause,
          })
      )
    );

    const { webhookSecret, apiKey } = config;

    if (!webhookSecret) {
      return yield* new DeliveryRequestError({
        errorCode: "resend_webhook_secret_missing",
        message: "RESEND_WEBHOOK_SECRET is not configured.",
        eventId: headers.id,
      });
    }

    if (!apiKey) {
      return yield* new DeliveryRequestError({
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
        new DeliveryRequestError({
          errorCode: "resend_webhook_verification_failed",
          message: "Resend webhook signature verification failed.",
          eventId: headers.id,
          cause,
        }),
    });

    return yield* processVerifiedEvent(
      {
        eventId: headers.id,
        event: verifiedPayload,
        deploymentEnvironment: config.deploymentEnvironment,
      },
      handlers
    );
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({ operation: "resendWebhook" })
    )
);

const processVerifiedEvent = Effect.fn("resendWebhook.processVerifiedEvent")(
  function* <R>(
    input: {
      readonly eventId: ResendWebhookEventId;
      readonly event: unknown;
      readonly deploymentEnvironment: string;
    },
    handlers: readonly DeliveryReportHandler<R>[]
  ) {
    const event = yield* Schema.decodeUnknownEffect(ResendWebhookEventSchema)(
      input.event
    ).pipe(
      Effect.mapError(
        (cause) =>
          new DeliveryRequestError({
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

    const tags = tagMap(event.data.tags);
    const handler = handlers.find(
      (candidate) => candidate.category === tags.get(categoryTag)
    );
    if (!handler) {
      return ignoredDeliveryReport("unhandled_email_kind");
    }

    return yield* handler.receive({
      eventId: input.eventId,
      event: event.type,
      emailId: event.data.email_id,
      occurredAt: event.created_at,
      tags,
      deploymentEnvironment: input.deploymentEnvironment,
    });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({ operation: "resendWebhook" })
    )
);
