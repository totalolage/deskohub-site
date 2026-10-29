import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Effect, Layer } from "effect";
import {
  makeMemoryQueue,
  unavailableQueue,
} from "@/shared/backend/queue/memory-queue.test-utils";
import type { QueuePublisher } from "@/shared/backend/queue/queue-publisher";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  AutomationUnitQueue,
  automationUnitTopic,
} from "./automation-unit-queue.service";
import type { EnqueuedAutomationUnit } from "./automation-unit-slots";

const unitId = "unit-1" as AutomationWorkUnitId;

const enqueue = (
  queue: Layer.Layer<QueuePublisher>,
  units: ReadonlyArray<EnqueuedAutomationUnit>
) =>
  Effect.flatMap(AutomationUnitQueue, (service) => service.enqueue(units)).pipe(
    Effect.provide(AutomationUnitQueue.Default.pipe(Layer.provide(queue))),
    Effect.result,
    Effect.runPromise
  );

describe("automation unit queue", () => {
  test("publishes one message per enqueue generation", async () => {
    const queue = makeMemoryQueue();

    await enqueue(queue.layer, [
      { unitId, enqueueGeneration: 0 },
      { unitId, enqueueGeneration: 1 },
    ]);

    expect(queue.published()).toEqual([
      {
        topic: "workspace-email-automation-unit",
        message: { unitId },
        options: { idempotencyKey: "email-automation-unit:unit-1:0" },
      },
      {
        topic: "workspace-email-automation-unit",
        message: { unitId },
        options: { idempotencyKey: "email-automation-unit:unit-1:1" },
      },
    ]);
    // The queue's own retention applies.
    expect(queue.published()[0]?.options.retentionSeconds).toBeUndefined();
    expect(JSON.stringify(queue.published()[0]?.message)).toBe(
      '{"unitId":"unit-1"}'
    );
  });

  test("treats a duplicate message as already enqueued", async () => {
    const queue = makeMemoryQueue();

    await enqueue(queue.layer, [{ unitId, enqueueGeneration: 0 }]);
    const result = await enqueue(queue.layer, [
      { unitId, enqueueGeneration: 0 },
    ]);

    expect(result._tag).toBe("Success");
    expect(queue.published()).toHaveLength(1);
  });

  test("fails when the queue is unavailable", async () => {
    const result = await enqueue(unavailableQueue(), [
      { unitId, enqueueGeneration: 0 },
    ]);

    expect(result).toMatchObject({
      failure: { _tag: "QueueMessageSendError" },
    });
  });

  test("decodes only well-formed messages", () => {
    for (const message of [{}, { unitId: "" }, { unitId: 1 }]) {
      expect(
        decodeStandardSchema(automationUnitTopic.message, message)
      ).toBeUndefined();
    }
    expect(
      decodeStandardSchema(automationUnitTopic.message, { unitId })
    ).toEqual({ unitId });
  });
});
