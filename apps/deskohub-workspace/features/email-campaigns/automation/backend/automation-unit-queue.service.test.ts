import { describe, expect, mock, test } from "bun:test";
import { DuplicateMessageError } from "@vercel/queue";
import { Effect, Exit } from "effect";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  automationUnitQueueTopic,
  makeAutomationUnitQueue,
} from "./automation-unit-queue.service";

const unitId = "unit-1" as AutomationWorkUnitId;

describe("automation unit queue", () => {
  test("publishes one message per enqueue generation", async () => {
    const send = mock(() => Promise.resolve({} as never));

    await makeAutomationUnitQueue(send as never)
      .enqueue([
        { unitId, enqueueGeneration: 0 },
        { unitId, enqueueGeneration: 1 },
      ])
      .pipe(Effect.runPromise);

    expect(send.mock.calls).toEqual([
      [
        automationUnitQueueTopic,
        { unitId },
        { idempotencyKey: "email-automation-unit:unit-1:0" },
      ],
      [
        automationUnitQueueTopic,
        { unitId },
        { idempotencyKey: "email-automation-unit:unit-1:1" },
      ],
    ] as never);
  });

  test("treats a duplicate message as already enqueued", async () => {
    const send = mock(() => Promise.reject(new DuplicateMessageError("dup")));

    const exit = await makeAutomationUnitQueue(send as never)
      .enqueue([{ unitId, enqueueGeneration: 0 }])
      .pipe(Effect.runPromiseExit);

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("fails when the queue is unavailable", async () => {
    const send = mock(() => Promise.reject(new Error("unavailable")));

    const exit = await makeAutomationUnitQueue(send as never)
      .enqueue([{ unitId, enqueueGeneration: 0 }])
      .pipe(Effect.runPromiseExit);

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
