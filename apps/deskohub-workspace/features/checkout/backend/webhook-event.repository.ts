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
}> {
  get code() {
    return "WEBHOOK_EVENT_STATE_ERROR";
  }
}

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
      insertReceived: (input) =>
        runDb("webhookEvents.insertReceived", async () => {
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

          return event
            ? { status: "inserted", event }
            : { status: "duplicate" };
        }),

      markProcessed: (input) =>
        Effect.gen(function* () {
          const updated = yield* runDb("webhookEvents.markProcessed", () =>
            db
              .update(webhookEvents)
              .set({
                status: "processed",
                processedAt: input.processedAt,
                errorCode: null,
                updatedAt: new Date(),
              })
              .where(eventIdentityWhere(input))
              .returning({ id: webhookEvents.id })
          );

          yield* ensureUpdated(
            updated,
            "webhookEvents.markProcessed",
            eventIdentityLabel(input)
          );
        }),

      markFailed: (input) =>
        Effect.gen(function* () {
          const updated = yield* runDb("webhookEvents.markFailed", () =>
            db
              .update(webhookEvents)
              .set({
                status: "failed",
                errorCode: input.errorCode,
                updatedAt: new Date(),
              })
              .where(eventIdentityWhere(input))
              .returning({ id: webhookEvents.id })
          );

          yield* ensureUpdated(
            updated,
            "webhookEvents.markFailed",
            eventIdentityLabel(input)
          );
        }),
    });
  })
);
