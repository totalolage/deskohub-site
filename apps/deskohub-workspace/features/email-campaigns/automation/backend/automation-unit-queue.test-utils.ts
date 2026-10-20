import { Effect, Layer, Result } from "effect";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  type AutomationUnitOutcome,
  AutomationUnitProcessor,
} from "./automation-unit-processor.service";
import { AutomationUnitQueue } from "./automation-unit-queue.service";

export type AutomationUnitQueueFakeMessage = {
  readonly unitId: AutomationWorkUnitId;
  readonly idempotencyKey: string;
};

/**
 * An in-process unit queue. It records every published message, drops a
 * repeated idempotency key as the real queue does, and lets a test deliver,
 * redeliver, drop or duplicate pending messages.
 */
export const makeAutomationUnitQueueFake = () => {
  const keys = new Set<string>();
  const published: Array<AutomationUnitQueueFakeMessage> = [];
  const pending: Array<AutomationUnitQueueFakeMessage> = [];

  const layer = Layer.succeed(AutomationUnitQueue, {
    enqueue: (units) =>
      Effect.sync(() => {
        for (const unit of units) {
          const idempotencyKey = `email-automation-unit:${unit.unitId}:${unit.enqueueGeneration}`;
          if (keys.has(idempotencyKey)) continue;
          keys.add(idempotencyKey);
          const message = { unitId: unit.unitId, idempotencyKey };
          published.push(message);
          pending.push(message);
        }
      }),
  });

  return {
    layer,
    /** Every message ever published, in order. */
    published: (): ReadonlyArray<AutomationUnitQueueFakeMessage> => [
      ...published,
    ],
    /** Messages not yet taken, in delivery order. */
    pending: (): ReadonlyArray<AutomationUnitQueueFakeMessage> => [...pending],
    /** Removes and returns the next pending message. */
    take: () => pending.shift(),
    /** Puts a message back at the end, as a redelivery after a failure. */
    redeliver: (message: AutomationUnitQueueFakeMessage) => {
      pending.push(message);
    },
    /** Loses every pending message, as an expired or lost publish. */
    dropPending: () => {
      pending.length = 0;
    },
  };
};

export type AutomationUnitQueueFake = ReturnType<
  typeof makeAutomationUnitQueueFake
>;

/**
 * Delivers pending messages to the processor until none remain, putting a
 * failed delivery back at the end as the queue would. Stops after
 * `maxDeliveries` so a unit that never succeeds can't loop forever.
 */
export const drainAutomationUnitQueue = Effect.fn("drainAutomationUnitQueue")(
  function* (
    queue: AutomationUnitQueueFake,
    options: { readonly maxDeliveries?: number } = {}
  ) {
    const processor = yield* AutomationUnitProcessor;
    const deliveries: Array<{
      readonly unitId: AutomationWorkUnitId;
      readonly outcome: AutomationUnitOutcome | "redelivered";
    }> = [];
    const maxDeliveries = options.maxDeliveries ?? 100;

    for (
      let message = queue.take();
      message !== undefined && deliveries.length < maxDeliveries;
      message = queue.take()
    ) {
      const result = yield* Effect.result(processor.process(message.unitId));
      if (Result.isFailure(result)) queue.redeliver(message);
      deliveries.push({
        unitId: message.unitId,
        outcome: Result.isSuccess(result) ? result.success : "redelivered",
      });
    }

    return deliveries;
  }
);
