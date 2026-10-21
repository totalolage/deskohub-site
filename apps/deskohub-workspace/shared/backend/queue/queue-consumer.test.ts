import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { MessageMetadata } from "@vercel/queue";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Data, Effect, Result } from "effect";
import { SqlError } from "effect/unstable/sql";
import {
  decideQueueRedelivery,
  deliverQueueMessage,
  previewQueueDeliveryLimit,
  QueueDeliveryFailure,
  QueueRedelivery,
  queueRetryDirective,
} from "./queue-consumer";

class PermanentTestFailure extends Data.TaggedError("PermanentTestFailure") {}
class TransientTestFailure extends Data.TaggedError("TransientTestFailure") {}
class ScheduledTestFailure extends Data.TaggedError("ScheduledTestFailure")<{
  readonly at: Temporal.Instant;
}> {}
class UnclassifiedTestFailure extends Data.TaggedError(
  "UnclassifiedTestFailure"
)<{ readonly cause?: unknown }> {}

type TestFailure =
  | PermanentTestFailure
  | TransientTestFailure
  | ScheduledTestFailure
  | UnclassifiedTestFailure;

const now = Temporal.Instant.from("2026-10-20T12:00:00Z");

const redelivery = (failure: TestFailure): QueueRedelivery => {
  if (failure instanceof PermanentTestFailure) return QueueRedelivery.Never();
  if (failure instanceof TransientTestFailure) {
    return QueueRedelivery.WithBackoff();
  }
  if (failure instanceof ScheduledTestFailure) {
    return QueueRedelivery.At({ instant: failure.at });
  }
  return QueueRedelivery.Default();
};

const unavailableDatabase = new UnclassifiedTestFailure({
  cause: new EffectDrizzleQueryError({
    query: "select 1",
    params: [],
    cause: Cause.fail(
      new SqlError.SqlError({
        reason: new SqlError.AuthenticationError({
          cause: Object.assign(new Error("password authentication failed"), {
            code: "28P01",
          }),
          operation: "acquireConnection",
        }),
      })
    ),
  }),
});

const decide = (input: {
  readonly failure: TestFailure;
  readonly deliveryCount?: number;
  readonly environment?: "production" | "preview" | "development";
}) =>
  decideQueueRedelivery({
    cause: Cause.fail(input.failure),
    redelivery,
    deliveryCount: input.deliveryCount ?? 1,
    environment: input.environment ?? "production",
    now,
  });

const metadata = (deliveryCount: number): MessageMetadata => ({
  messageId: "message-id",
  deliveryCount,
  createdAt: new Date(now.epochMilliseconds),
  expiresAt: new Date(now.add({ hours: 24 }).epochMilliseconds),
  topicName: "test-topic",
  consumerGroup: "test-consumer",
  region: "fra1",
});

describe("decideQueueRedelivery", () => {
  test("acknowledges a permanent failure", () => {
    expect(decide({ failure: new PermanentTestFailure() })).toEqual({
      reason: "permanent_failure",
      directive: { acknowledge: true },
    });
  });

  test("backs a transient failure off exponentially up to its cap", () => {
    const delays = [1, 2, 3, 4, 5, 6, 30].map(
      (deliveryCount) =>
        decide({ failure: new TransientTestFailure(), deliveryCount }).directive
    );

    expect(delays).toEqual([
      { afterSeconds: 60 },
      { afterSeconds: 120 },
      { afterSeconds: 240 },
      { afterSeconds: 480 },
      { afterSeconds: 900 },
      { afterSeconds: 900 },
      { afterSeconds: 900 },
    ]);
  });

  test("redelivers scheduled work when it becomes due, within the visibility limit", () => {
    expect(
      decide({
        failure: new ScheduledTestFailure({
          at: now.add({ minutes: 7, milliseconds: 1 }),
        }),
      }).directive
    ).toEqual({ afterSeconds: 7 * 60 + 1 });
    expect(
      decide({
        failure: new ScheduledTestFailure({ at: now.add({ hours: 3 }) }),
      }).directive
    ).toEqual({ afterSeconds: 60 * 60 });
    expect(
      decide({
        failure: new ScheduledTestFailure({ at: now.subtract({ minutes: 1 }) }),
      }).directive
    ).toEqual({ afterSeconds: 1 });
  });

  test("leaves an unclassified failure to the trigger's retry delay", () => {
    expect(decide({ failure: new UnclassifiedTestFailure({}) })).toEqual({
      reason: "unclassified",
      directive: undefined,
    });
  });

  test("classifies only a lone typed failure", () => {
    expect(
      decideQueueRedelivery({
        cause: Cause.combine(
          Cause.fail(new PermanentTestFailure()),
          Cause.die(new Error("defect"))
        ),
        redelivery,
        deliveryCount: 1,
        environment: "production",
        now,
      }).directive
    ).toBeUndefined();
  });

  test("acknowledges a Preview message whose database is gone", () => {
    expect(
      decide({ failure: unavailableDatabase, environment: "preview" })
    ).toEqual({
      reason: "preview_database_unavailable",
      directive: { acknowledge: true },
    });
  });

  test.each(["production", "development"] as const)(
    "keeps retrying an unavailable database in %s with backoff",
    (environment) => {
      expect(
        decide({ failure: unavailableDatabase, environment, deliveryCount: 3 })
      ).toEqual({
        reason: "database_unavailable",
        directive: { afterSeconds: 240 },
      });
    }
  );

  test("never lets a consumer acknowledge an unavailable database outside Preview", () => {
    expect(
      decideQueueRedelivery({
        cause: Cause.fail(unavailableDatabase),
        redelivery: () => QueueRedelivery.Never(),
        deliveryCount: 1,
        environment: "production",
        now,
      }).directive
    ).toEqual({ afterSeconds: 60 });
  });

  test("abandons a failing Preview message at the delivery limit only", () => {
    const failure = new UnclassifiedTestFailure({});

    expect(
      decide({
        failure,
        environment: "preview",
        deliveryCount: previewQueueDeliveryLimit - 1,
      }).directive
    ).toBeUndefined();
    expect(
      decide({
        failure,
        environment: "preview",
        deliveryCount: previewQueueDeliveryLimit,
      })
    ).toEqual({
      reason: "preview_delivery_limit",
      directive: { acknowledge: true },
    });
    expect(
      decide({
        failure,
        environment: "production",
        deliveryCount: 500,
      }).directive
    ).toBeUndefined();
  });
});

describe("deliverQueueMessage", () => {
  const deliver = (
    consume: () => Effect.Effect<unknown, TestFailure>,
    deliveryCount = 1
  ) =>
    deliverQueueMessage({ consume, redelivery, environment: "production" })(
      { orderId: "order-id" },
      metadata(deliveryCount)
    ).pipe(Effect.result, Effect.runPromise);

  test("completes a delivery the consumer handled", async () => {
    expect(await deliver(() => Effect.succeed("processed"))).toEqual(
      Result.succeed(undefined)
    );
  });

  test("replaces a failure with its directive and drops the cause", async () => {
    const result = await deliver(() => Effect.fail(unavailableDatabase), 2);

    expect(result).toMatchObject({
      failure: {
        _tag: "QueueDeliveryFailure",
        reason: "database_unavailable",
        directive: { afterSeconds: 120 },
      },
    });
    expect(Result.isFailure(result) && "cause" in result.failure).toBe(false);
    expect(
      queueRetryDirective(Result.isFailure(result) ? result.failure : null)
    ).toEqual({ afterSeconds: 120 });
  });

  test("sanitizes a consumer that throws while building its Effect", async () => {
    const privateValue = "private-consumer-value";
    const result = await deliver(() => {
      throw new Error(privateValue);
    });

    expect(result).toMatchObject({
      failure: {
        _tag: "QueueDeliveryFailure",
        reason: "unclassified",
        directive: undefined,
      },
    });
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });

  test("keeps an interruption unclassified", async () => {
    const exit = await deliverQueueMessage({
      consume: () => Effect.interrupt,
      redelivery,
      environment: "production",
    })({}, metadata(1)).pipe(Effect.exit, Effect.runPromise);

    expect(exit._tag === "Failure" && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true
    );
  });
});

describe("queueRetryDirective", () => {
  test("rethrows anything that is not a delivery failure", () => {
    expect(queueRetryDirective(new Error("runtime failed"))).toBeUndefined();
    expect(
      queueRetryDirective(
        new QueueDeliveryFailure({
          message: "Queue message failed; the queue redelivers it",
          reason: "unclassified",
          directive: undefined,
        })
      )
    ).toBeUndefined();
  });
});
