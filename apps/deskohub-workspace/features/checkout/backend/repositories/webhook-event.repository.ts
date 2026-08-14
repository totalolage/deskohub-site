import type { NexiOrderId, NexiWebhookEventId } from "@deskohub/nexi";
import { and, eq, ne } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { type WebhookEvent, webhookEvents } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import type {
  PaymentAttemptId,
  StoredWebhookEventId,
} from "@/features/checkout/checkout-identifiers";

export class WebhookEventStateError extends Data.TaggedError(
  "WebhookEventStateError"
)<{
  readonly operation: string;
  readonly eventId: NexiWebhookEventId | StoredWebhookEventId;
  readonly message: string;
}> {}

export type InsertWebhookEventResult =
  | { readonly status: "inserted"; readonly event: WebhookEvent }
  | { readonly status: "duplicate"; readonly event: WebhookEvent };

export type WebhookEventIdentity =
  | { readonly type: "id"; readonly id: StoredWebhookEventId }
  | { readonly type: "eventId"; readonly eventId: NexiWebhookEventId };

export interface IWebhookEventRepository {
  readonly insertReceived: (input: {
    readonly eventId: NexiWebhookEventId;
    readonly paymentAttemptId?: PaymentAttemptId;
    readonly providerOrderId?: NexiOrderId;
    readonly receivedAt: Temporal.Instant;
  }) => Effect.Effect<InsertWebhookEventResult, EffectDrizzleQueryError>;
  readonly markProcessed: (
    input: WebhookEventIdentity & {
      readonly processedAt: Temporal.Instant;
    }
  ) => Effect.Effect<void, EffectDrizzleQueryError | WebhookEventStateError>;
  readonly markFailed: (
    input: WebhookEventIdentity & {
      readonly errorCode: string;
    }
  ) => Effect.Effect<void, EffectDrizzleQueryError | WebhookEventStateError>;
  readonly linkPaymentAttempt: (
    input: WebhookEventIdentity & {
      readonly paymentAttemptId: PaymentAttemptId;
    }
  ) => Effect.Effect<void, EffectDrizzleQueryError | WebhookEventStateError>;
  readonly claimRetry: (
    input: WebhookEventIdentity
  ) => Effect.Effect<"claimed" | "processed", EffectDrizzleQueryError>;
}

const eventIdentityWhere = (input: WebhookEventIdentity) =>
  input.type === "id"
    ? eq(webhookEvents.id, input.id)
    : eq(webhookEvents.eventId, input.eventId);

const eventIdentityLabel = (input: WebhookEventIdentity) =>
  input.type === "id" ? input.id : input.eventId;

const ensureUpdated = (
  updated: readonly Pick<WebhookEvent, "id">[],
  operation: string,
  eventId: NexiWebhookEventId | StoredWebhookEventId
) =>
  updated.length > 0
    ? Effect.void
    : Effect.fail(
        new WebhookEventStateError({
          operation,
          eventId,
          message: "Webhook event was not found",
        })
      );

export class WebhookEventRepository extends Context.Service<
  WebhookEventRepository,
  IWebhookEventRepository
>()("WebhookEventRepository") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return WebhookEventRepository.of({
        insertReceived: Effect.fn("webhookEvents.insertReceived")(
          function* (input) {
            const [event] = yield* db
              .insert(webhookEvents)
              .values({
                id: postgresUuidV7,
                provider: "nexi",
                eventId: input.eventId,
                paymentAttemptId: input.paymentAttemptId,
                providerOrderId: input.providerOrderId,
                receivedAt: input.receivedAt,
                state: "received",
              })
              .onConflictDoNothing({ target: webhookEvents.eventId })
              .returning();

            if (event) return { status: "inserted" as const, event };

            const [existing] = yield* db
              .select()
              .from(webhookEvents)
              .where(eq(webhookEvents.eventId, input.eventId))
              .limit(1);

            if (!existing) {
              return yield* Effect.die("Webhook event duplicate not found.");
            }
            return { status: "duplicate" as const, event: existing };
          },
          (effect, input) => effect.pipe(Effect.annotateLogs(input))
        ),

        markProcessed: Effect.fn("webhookEvents.markProcessed")(
          function* (input) {
            const updated = yield* db
              .update(webhookEvents)
              .set({
                state: "processed",
                processedAt: input.processedAt,
                errorCode: null,
              })
              .where(eventIdentityWhere(input))
              .returning({ id: webhookEvents.id });

            yield* ensureUpdated(
              updated,
              "webhookEvents.markProcessed",
              eventIdentityLabel(input)
            );
          },
          (effect, input) => effect.pipe(Effect.annotateLogs(input))
        ),

        claimRetry: Effect.fn("webhookEvents.claimRetry")(
          function* (input) {
            const [claimed] = yield* db
              .update(webhookEvents)
              .set({
                state: "received",
                processedAt: null,
                errorCode: null,
              })
              .where(
                and(
                  eventIdentityWhere(input),
                  ne(webhookEvents.state, "processed")
                )
              )
              .returning({ id: webhookEvents.id });

            if (claimed) return "claimed";

            const [processed] = yield* db
              .select({ id: webhookEvents.id })
              .from(webhookEvents)
              .where(
                and(
                  eventIdentityWhere(input),
                  eq(webhookEvents.state, "processed")
                )
              )
              .limit(1);

            return processed ? "processed" : "claimed";
          },
          (effect, input) => effect.pipe(Effect.annotateLogs(input))
        ),

        linkPaymentAttempt: Effect.fn("webhookEvents.linkPaymentAttempt")(
          function* (input) {
            const updated = yield* db
              .update(webhookEvents)
              .set({ paymentAttemptId: input.paymentAttemptId })
              .where(eventIdentityWhere(input))
              .returning({ id: webhookEvents.id });

            yield* ensureUpdated(
              updated,
              "webhookEvents.linkPaymentAttempt",
              eventIdentityLabel(input)
            );
          },
          (effect, input) => effect.pipe(Effect.annotateLogs(input))
        ),

        markFailed: Effect.fn("webhookEvents.markFailed")(
          function* (input) {
            const updated = yield* db
              .update(webhookEvents)
              .set({
                state: "failed",
                errorCode: input.errorCode,
              })
              .where(
                and(
                  eventIdentityWhere(input),
                  ne(webhookEvents.state, "processed")
                )
              )
              .returning({ id: webhookEvents.id });

            yield* ensureUpdated(
              updated,
              "webhookEvents.markFailed",
              eventIdentityLabel(input)
            );
          },
          (effect, input) => effect.pipe(Effect.annotateLogs(input))
        ),
      });
    })
  );

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(WorkspaceDatabase.Live)
  );
}
