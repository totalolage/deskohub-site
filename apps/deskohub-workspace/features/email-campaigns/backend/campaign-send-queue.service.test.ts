import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Effect, Layer } from "effect";
import {
  makeMemoryQueue,
  unavailableQueue,
} from "@/shared/backend/queue/memory-queue.test-utils";
import type { QueuePublisher } from "@/shared/backend/queue/queue-publisher";
import type { CampaignSendId } from "../campaign-identifiers";
import {
  CampaignSendQueueService,
  campaignSendTopic,
} from "./campaign-send-queue.service";

const sendId = "send-1" as CampaignSendId;

const enqueue = (queue: Layer.Layer<QueuePublisher>, deliveryAttempt: number) =>
  Effect.flatMap(CampaignSendQueueService, (service) =>
    service.enqueue({ sendId, deliveryAttempt })
  ).pipe(
    Effect.provide(CampaignSendQueueService.Default.pipe(Layer.provide(queue))),
    Effect.result,
    Effect.runPromise
  );

describe("campaign send queue", () => {
  test("publishes one idempotent message per delivery attempt", async () => {
    const queue = makeMemoryQueue();

    await enqueue(queue.layer, 2);

    expect(queue.published()).toEqual([
      {
        topic: "workspace-email-campaign-send",
        message: { sendId, deliveryAttempt: 2 },
        options: {
          retentionSeconds: 48 * 60 * 60,
          idempotencyKey: "email-campaign-send:send-1:2",
        },
      },
    ]);
    expect(JSON.stringify(queue.published()[0]?.message)).toBe(
      '{"sendId":"send-1","deliveryAttempt":2}'
    );
  });

  test("treats a duplicate message as already enqueued", async () => {
    const queue = makeMemoryQueue();

    await enqueue(queue.layer, 1);
    const result = await enqueue(queue.layer, 1);

    expect(result._tag).toBe("Success");
    expect(queue.published()).toHaveLength(1);
  });

  test("fails with a queue error when the queue is unavailable", async () => {
    const result = await enqueue(unavailableQueue(), 1);

    expect(result).toMatchObject({
      failure: {
        _tag: "CampaignSendQueueError",
        cause: { _tag: "QueueMessageSendError" },
      },
    });
  });

  test("decodes only well-formed messages", () => {
    for (const message of [
      { sendId: "", deliveryAttempt: 1 },
      { sendId, deliveryAttempt: 0 },
      { sendId, deliveryAttempt: 1.5 },
      { sendId },
    ]) {
      expect(
        decodeStandardSchema(campaignSendTopic.message, message)
      ).toBeUndefined();
    }
    expect(
      decodeStandardSchema(campaignSendTopic.message, {
        sendId,
        deliveryAttempt: 1,
      })
    ).toEqual({ sendId, deliveryAttempt: 1 });
  });
});
