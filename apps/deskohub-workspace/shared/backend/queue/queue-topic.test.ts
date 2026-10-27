import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, spyOn, test } from "bun:test";
import * as vercelQueue from "@vercel/queue";
import { Data, Duration, Effect, Schema } from "effect";

type QueueRoute = {
  readonly handler: vercelQueue.MessageHandler;
  readonly options: Parameters<typeof vercelQueue.handleCallback>[1];
};

// The handler `handleCallback` wraps is the topic's consumer, so a test can
// deliver a message to it without the queue's callback protocol.
let defined: QueueRoute | undefined;
mock.module("@vercel/queue", () => ({
  ...vercelQueue,
  handleCallback: (
    handler: QueueRoute["handler"],
    options: QueueRoute["options"]
  ) => {
    defined = { handler, options };
    return () => Promise.resolve(new Response());
  },
}));

const { QueueRedelivery } = await import("./queue-consumer");
const { defineQueueTopic } = await import("./queue-topic");
const { makeMemoryQueue } = await import("./memory-queue.test-utils");

class ParcelNotReadyError extends Data.TaggedError("ParcelNotReadyError") {}

const parcelTopic = defineQueueTopic({
  topic: "workspace-test-parcel",
  label: "Parcel",
  message: Schema.toStandardSchemaV1(
    Schema.Struct({
      parcelId: Schema.NonEmptyString.pipe(Schema.brand("ParcelId")),
    })
  ),
  publish: (input: {
    readonly parcelId: string;
    readonly attempt: number;
  }) => ({
    message: { parcelId: input.parcelId },
    key: `parcel:${input.parcelId}:${input.attempt}`,
  }),
  retention: Duration.hours(2),
});

const metadata: vercelQueue.MessageMetadata = {
  messageId: "message-id",
  deliveryCount: 1,
  createdAt: new Date("2026-10-20T12:00:00Z"),
  expiresAt: new Date("2026-10-21T12:00:00Z"),
  topicName: parcelTopic.topic,
  consumerGroup: "test-consumer",
  region: "fra1",
};

const routeFor = (
  handle: (message: {
    readonly parcelId: string;
  }) => Effect.Effect<unknown, ParcelNotReadyError>
): QueueRoute => {
  parcelTopic.consume("parcelQueue", handle, () =>
    QueueRedelivery.WithBackoff()
  );
  if (defined === undefined) throw new Error("No queue route was defined");
  return defined;
};

describe("defineQueueTopic", () => {
  test("publishes a message with its key and the topic's retention", () => {
    expect(parcelTopic.publication({ parcelId: "p-1", attempt: 2 })).toEqual({
      topic: "workspace-test-parcel",
      message: { parcelId: "p-1" },
      options: { retentionSeconds: 7200, idempotencyKey: "parcel:p-1:2" },
    });
  });

  test("lets one message hold its delivery back and replace the retention", () => {
    const delayedTopic = defineQueueTopic({
      topic: "workspace-test-delayed",
      label: "Delayed",
      message: Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })),
      publish: (id: string) => ({
        message: { id },
        key: `delayed:${id}`,
        delay: Duration.seconds(0),
        retention: Duration.seconds(90),
      }),
      retention: Duration.hours(2),
    });
    const undatedTopic = defineQueueTopic({
      topic: "workspace-test-undated",
      label: "Undated",
      message: Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })),
      publish: (id: string) => ({ message: { id }, key: `undated:${id}` }),
    });

    expect(delayedTopic.publication("a").options).toEqual({
      delaySeconds: 0,
      retentionSeconds: 90,
      idempotencyKey: "delayed:a",
    });
    // The queue's own retention applies: no option is sent.
    const { options } = undatedTopic.publication("a");
    expect([options.delaySeconds, options.retentionSeconds]).toEqual([
      undefined,
      undefined,
    ]);
  });

  test("publishes through the QueuePublisher and drops a repeated key", async () => {
    const queue = makeMemoryQueue();

    const outcomes = await Effect.all([
      parcelTopic.publish({ parcelId: "p-1", attempt: 1 }),
      parcelTopic.publish({ parcelId: "p-1", attempt: 1 }),
      parcelTopic.publish({ parcelId: "p-1", attempt: 2 }),
    ]).pipe(Effect.provide(queue.layer), Effect.runPromise);

    expect(outcomes).toEqual(["published", "duplicate", "published"]);
    expect(
      queue.published().map(({ options }) => options.idempotencyKey)
    ).toEqual(["parcel:p-1:1", "parcel:p-1:2"]);
  });

  test("hands the consumer the decoded message", async () => {
    const handle = mock((message: { readonly parcelId: string }) =>
      Effect.succeed(message)
    );

    await routeFor(handle).handler({ parcelId: "p-1", extra: true }, metadata);

    expect(handle.mock.calls).toEqual([[{ parcelId: "p-1" }]]);
  });

  test("acknowledges a message that doesn't decode without consuming it", async () => {
    const handle = mock(() => Effect.succeed("consumed"));
    const warn = spyOn(console, "warn");

    // Resolving acknowledges the message.
    for (const message of [{ parcelId: "" }, {}, "p-1", null]) {
      await routeFor(handle).handler(message, metadata);
    }
    expect(handle).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.filter(([line]) =>
        String(line).includes(
          'message="Parcel queue message ignored: invalid payload"'
        )
      )
    ).toHaveLength(4);
    warn.mockRestore();
  });

  test("redelivers a failed delivery as the consumer classifies it", async () => {
    const route = routeFor(() => Effect.fail(new ParcelNotReadyError()));

    const failure = await Promise.resolve(
      route.handler({ parcelId: "p-1" }, metadata)
    ).then(
      () => undefined,
      (cause: unknown) => cause
    );

    expect(failure).toMatchObject({
      _tag: "QueueDeliveryFailure",
      reason: "transient_failure",
      directive: { afterSeconds: 60 },
    });
    expect(route.options?.retry?.(failure, metadata)).toEqual({
      afterSeconds: 60,
    });
  });
});
