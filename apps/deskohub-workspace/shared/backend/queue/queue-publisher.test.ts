import { describe, expect, mock, test } from "bun:test";
import * as vercelQueue from "@vercel/queue";
import { Effect } from "effect";

let sendResult: () => Promise<unknown> = () => Promise.resolve({});
const send = mock((..._args: Parameters<typeof vercelQueue.send>) =>
  sendResult()
);
mock.module("@vercel/queue", () => ({ ...vercelQueue, send }));

const { QueuePublisher } = await import("./queue-publisher");

const publication = {
  topic: "workspace-test-topic",
  message: { id: "message-1" },
  options: { retentionSeconds: 60, idempotencyKey: "test:message-1" },
};

const publish = () =>
  Effect.flatMap(QueuePublisher, (publisher) =>
    publisher.publish(publication)
  ).pipe(
    Effect.provide(QueuePublisher.Default),
    Effect.result,
    Effect.runPromise
  );

describe("QueuePublisher", () => {
  test("sends the message to its topic with its options", async () => {
    sendResult = () => Promise.resolve({ messageId: "id" });

    expect(await publish()).toMatchObject({ success: "published" });
    expect(send).toHaveBeenLastCalledWith(
      publication.topic,
      publication.message,
      publication.options
    );
  });

  test("succeeds as a duplicate when the key was already published", async () => {
    sendResult = () =>
      Promise.reject(new vercelQueue.DuplicateMessageError("duplicate"));

    expect(await publish()).toMatchObject({ success: "duplicate" });
  });

  test("fails with the topic and cause when the queue rejects the message", async () => {
    const cause = new Error("queue down");
    sendResult = () => Promise.reject(cause);

    expect(await publish()).toMatchObject({
      failure: {
        _tag: "QueueMessageSendError",
        topic: publication.topic,
        cause,
      },
    });
  });
});
