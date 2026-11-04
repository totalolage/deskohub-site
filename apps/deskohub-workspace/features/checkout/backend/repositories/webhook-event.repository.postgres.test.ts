import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { NexiOrderIdSchema, NexiWebhookEventIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { webhookEvents } from "@/db/schema";
import { captureDatabaseQueryLogsWithExit } from "@/shared/testing/workspace-database-query-log.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type WebhookEventIdentity,
  WebhookEventRepository,
} from "./webhook-event.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "WebhookEventRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const eventIds: string[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from webhook_events where event_id = any($1)",
        [eventIds]
      );
    });

    /** Runs a repository operation and records the statements it logged. */
    const run = async <A, E>(
      operation: (
        repository: typeof WebhookEventRepository.Service
      ) => Effect.Effect<A, E>
    ) => {
      const { exit, logs } = await Effect.runPromise(
        captureDatabaseQueryLogsWithExit(
          Effect.gen(function* () {
            return yield* operation(yield* WebhookEventRepository);
          })
        ).pipe(
          Effect.provide(WebhookEventRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );
      if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
      return { value: exit.value, queries: logs.map(({ query }) => query) };
    };

    const newEventId = () => {
      const eventId = NexiWebhookEventIdSchema.make(
        `nexi-event-${crypto.randomUUID()}`
      );
      eventIds.push(eventId);
      return eventId;
    };

    const readEvent = async (eventId: string) => {
      const [event] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.eventId, eventId as never))
      );
      return event;
    };

    const receivedAt = Temporal.Instant.from("2026-10-20T08:00:00Z");

    const eventColumns =
      '"id", "provider", "event_id", "payment_attempt_id", "provider_order_id", "received_at"::text, "processed_at"::text, "state", "error_code", "created_at"::text, "updated_at"::text';
    const insertQuery = `insert into "webhook_events" ("id", "provider", "event_id", "payment_attempt_id", "provider_order_id", "received_at", "processed_at", "state", "error_code", "created_at", "updated_at") values (uuid_generate_v7()::text, $1, $2, default, default, $3, default, $4, default, default, default) on conflict ("event_id") do nothing returning ${eventColumns}`;
    const insertWithOrderQuery = `insert into "webhook_events" ("id", "provider", "event_id", "payment_attempt_id", "provider_order_id", "received_at", "processed_at", "state", "error_code", "created_at", "updated_at") values (uuid_generate_v7()::text, $1, $2, default, $3, $4, default, $5, default, default, default) on conflict ("event_id") do nothing returning ${eventColumns}`;
    const duplicateQuery = `select ${eventColumns} from "webhook_events" where "webhook_events"."event_id" = $1 limit $2`;
    const claimQuery = (column: "id" | "event_id") =>
      `update "webhook_events" set "processed_at" = $1, "state" = $2, "error_code" = $3 where (("webhook_events"."${column}" = $4) and ("webhook_events"."state" <> $5)) returning "id"`;
    const processedQuery = (column: "id" | "event_id") =>
      `select "id" from "webhook_events" where (("webhook_events"."${column}" = $1) and ("webhook_events"."state" = $2)) limit $3`;

    const insert = (
      eventId: ReturnType<typeof newEventId>,
      at: Temporal.Instant = receivedAt,
      providerOrderId?: string
    ) =>
      run((repository) =>
        repository.insertReceived({
          eventId,
          receivedAt: at,
          ...(providerOrderId && {
            providerOrderId: NexiOrderIdSchema.make(providerOrderId),
          }),
        })
      );

    const claim = (identity: WebhookEventIdentity) =>
      run((repository) => repository.claimRetry(identity));

    test("records a new event as received", async () => {
      const eventId = newEventId();

      const { value, queries } = await insert(eventId, receivedAt, "order-1");

      expect(queries).toEqual([insertWithOrderQuery]);
      expect(value.status).toBe("inserted");
      expect(value.event).toMatchObject({
        provider: "nexi",
        eventId,
        paymentAttemptId: null,
        providerOrderId: "order-1",
        processedAt: null,
        state: "received",
        errorCode: null,
      });
      expect(value.event.receivedAt.equals(receivedAt)).toBe(true);
      expect(await readEvent(eventId)).toEqual(value.event);
    });

    test("returns the stored event for a redelivered event without changing it", async () => {
      const eventId = newEventId();
      const first = await insert(eventId);

      const redelivered = await insert(
        eventId,
        receivedAt.add({ minutes: 5 }),
        "order-2"
      );

      expect(first.queries).toEqual([insertQuery]);
      expect(redelivered.queries).toEqual([
        insertWithOrderQuery,
        duplicateQuery,
      ]);
      expect(redelivered.value).toEqual({
        status: "duplicate",
        event: first.value.event,
      });
      expect(await readEvent(eventId)).toEqual(first.value.event);
    });

    test("inserts concurrent deliveries of one event once", async () => {
      const eventId = newEventId();

      const deliveries = await Promise.all([insert(eventId), insert(eventId)]);

      expect(deliveries.map(({ value }) => value.status).sort()).toEqual([
        "duplicate",
        "inserted",
      ]);
      const [first, second] = deliveries;
      expect(first?.value.event).toEqual(second?.value.event);
      const [{ count } = { count: 0 }] = (
        await testDatabase.pool.query<{ count: number }>(
          "select count(*)::int as count from webhook_events where event_id = $1",
          [eventId]
        )
      ).rows;
      expect(count).toBe(1);
    });

    test("claims a received event for retry by its Nexi event id", async () => {
      const eventId = newEventId();
      const { value: inserted } = await insert(eventId);

      const { value, queries } = await claim({ type: "eventId", eventId });

      expect(value).toBe("claimed");
      expect(queries).toEqual([claimQuery("event_id")]);
      expect(await readEvent(eventId)).toMatchObject({
        id: inserted.event.id,
        state: "received",
        processedAt: null,
        errorCode: null,
      });
    });

    test("reopens a failed event as received when claiming it by its stored id", async () => {
      const eventId = newEventId();
      const { value: inserted } = await insert(eventId);
      await run((repository) =>
        repository.markFailed({
          type: "id",
          id: inserted.event.id,
          errorCode: "payment_lookup_failed",
        })
      );
      expect((await readEvent(eventId))?.state).toBe("failed");

      const { value, queries } = await claim({
        type: "id",
        id: inserted.event.id,
      });

      expect(value).toBe("claimed");
      expect(queries).toEqual([claimQuery("id")]);
      expect(await readEvent(eventId)).toMatchObject({
        state: "received",
        processedAt: null,
        errorCode: null,
      });
    });

    test.each([
      ["Nexi event id", "eventId", "event_id"],
      ["stored id", "id", "id"],
    ] as const)(
      "reports a processed event as processed by its %s and leaves it unchanged",
      async (_name, type, column) => {
        const eventId = newEventId();
        const { value: inserted } = await insert(eventId);
        const processedAt = receivedAt.add({ seconds: 30 });
        await run((repository) =>
          repository.markProcessed({ type: "eventId", eventId, processedAt })
        );
        const processed = await readEvent(eventId);

        const { value, queries } = await claim(
          type === "id" ? { type, id: inserted.event.id } : { type, eventId }
        );

        expect(value).toBe("processed");
        expect(queries).toEqual([claimQuery(column), processedQuery(column)]);
        expect(await readEvent(eventId)).toEqual(processed);
        expect(processed?.state).toBe("processed");
        expect(processed?.processedAt?.equals(processedAt)).toBe(true);
      }
    );

    test("claims an event it has no record of", async () => {
      const eventId = newEventId();

      const { value, queries } = await claim({ type: "eventId", eventId });

      expect(value).toBe("claimed");
      expect(queries).toEqual([
        claimQuery("event_id"),
        processedQuery("event_id"),
      ]);
      expect(await readEvent(eventId)).toBeUndefined();
    });
  }
);
