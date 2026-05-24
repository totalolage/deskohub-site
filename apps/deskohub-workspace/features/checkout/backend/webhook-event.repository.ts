import { eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { type WebhookEvent, webhookEvents } from "@/db/schema";

export class WebhookEventStateError extends Data.TaggedError(
  "WebhookEventStateError"
)<{
  readonly operation: string;
  readonly eventId: string;
  readonly message: string;
}> {}

export type InsertWebhookEventResult =
  | { readonly status: "inserted"; readonly event: WebhookEvent }
  | { readonly status: "duplicate" };

export type WebhookEventIdentity =
  | { readonly type: "id"; readonly id: string }
  | { readonly type: "eventId"; readonly eventId: string };

export interface WebhookEventRepository {
  readonly insertReceived: (input: {
    readonly id: string;
    readonly eventId: string;
    readonly paymentOrderId?: string;
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
}

export const WebhookEventRepository =
  Context.GenericTag<WebhookEventRepository>("WebhookEventRepository");

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
                id: input.id,
                provider: "nexi",
                eventId: input.eventId,
                paymentOrderId: input.paymentOrderId,
                receivedAt: input.receivedAt,
                status: "received",
              })
              .onConflictDoNothing({ target: webhookEvents.eventId })
              .returning();

            return (
              event ? { status: "inserted", event } : { status: "duplicate" }
            ) satisfies InsertWebhookEventResult;
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
                status: "processed",
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

      markFailed: Effect.fn("webhookEvents.markFailed")(
        function* (input) {
          const updated = yield* runDb("webhookEvents.markFailed", () =>
            db
              .update(webhookEvents)
              .set({
                status: "failed",
                errorCode: input.errorCode,
              })
              .where(eventIdentityWhere(input))
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
