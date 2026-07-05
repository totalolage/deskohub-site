import { and, eq, ne } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { type WebhookEvent, webhookEvents } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";

export class WebhookEventStateError extends Data.TaggedError(
  "WebhookEventStateError"
)<{
  readonly operation: string;
  readonly eventId: string;
  readonly message: string;
}> {}

export type InsertWebhookEventResult =
  | { readonly status: "inserted"; readonly event: WebhookEvent }
  | { readonly status: "duplicate"; readonly event: WebhookEvent };

export type WebhookEventIdentity =
  | { readonly type: "id"; readonly id: string }
  | { readonly type: "eventId"; readonly eventId: string };

export interface WebhookEventRepository {
  readonly insertReceived: (input: {
    readonly eventId: string;
    readonly paymentAttemptId?: string;
    readonly providerOrderId?: string;
    readonly receivedAt: Date;
  }) => Effect.Effect<InsertWebhookEventResult, DatabaseError>;
  readonly markProcessed: (
    input: WebhookEventIdentity & {
      readonly processedAt: Date;
    }
  ) => Effect.Effect<void, DatabaseError | WebhookEventStateError>;
  readonly markFailed: (
    input: WebhookEventIdentity & {
      readonly errorCode: string;
    }
  ) => Effect.Effect<void, DatabaseError | WebhookEventStateError>;
  readonly linkPaymentAttempt: (
    input: WebhookEventIdentity & {
      readonly paymentAttemptId: string;
    }
  ) => Effect.Effect<void, DatabaseError | WebhookEventStateError>;
  readonly claimRetry: (
    input: WebhookEventIdentity
  ) => Effect.Effect<"claimed" | "processed", DatabaseError>;
}

export const WebhookEventRepository = Context.Service<WebhookEventRepository>(
  "WebhookEventRepository"
);

const eventIdentityWhere = (input: WebhookEventIdentity) =>
  input.type === "id"
    ? eq(webhookEvents.id, input.id)
    : eq(webhookEvents.eventId, input.eventId);

const eventIdentityLabel = (input: WebhookEventIdentity) =>
  input.type === "id" ? input.id : input.eventId;

const ensureUpdated = (
  updated: readonly Pick<WebhookEvent, "id">[],
  operation: string,
  eventId: string
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

export const WebhookEventRepositoryLive = Layer.effect(
  WebhookEventRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    return WebhookEventRepository.of({
      insertReceived: Effect.fn("webhookEvents.insertReceived")(
        function* (input) {
          return yield* runDb("webhookEvents.insertReceived", async () => {
            const [event] = await db
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

            const [existing] = await db
              .select()
              .from(webhookEvents)
              .where(eq(webhookEvents.eventId, input.eventId))
              .limit(1);

            if (!existing) throw new Error("Webhook event duplicate not found");
            return { status: "duplicate" as const, event: existing };
          });
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      markProcessed: Effect.fn("webhookEvents.markProcessed")(
        function* (input) {
          const updated = yield* runDb("webhookEvents.markProcessed", () =>
            db
              .update(webhookEvents)
              .set({
                state: "processed",
                processedAt: input.processedAt,
                errorCode: null,
              })
              .where(eventIdentityWhere(input))
              .returning({ id: webhookEvents.id })
          );

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
          return yield* runDb("webhookEvents.claimRetry", async () => {
            const [claimed] = await db
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

            if (claimed) return "claimed" as const;

            const [processed] = await db
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
          });
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      ),

      linkPaymentAttempt: Effect.fn("webhookEvents.linkPaymentAttempt")(
        function* (input) {
          const updated = yield* runDb("webhookEvents.linkPaymentAttempt", () =>
            db
              .update(webhookEvents)
              .set({ paymentAttemptId: input.paymentAttemptId })
              .where(eventIdentityWhere(input))
              .returning({ id: webhookEvents.id })
          );

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
          const updated = yield* runDb("webhookEvents.markFailed", () =>
            db
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
              .returning({ id: webhookEvents.id })
          );

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
