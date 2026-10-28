import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Effect, Layer, Result } from "effect";
import { makeMemoryQueue } from "@/shared/backend/queue/memory-queue.test-utils";
import type { QueuePublication } from "@/shared/backend/queue/queue-publisher";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  type AutomationUnitOutcome,
  AutomationUnitProcessor,
} from "./automation-unit-processor.service";
import {
  AutomationUnitQueue,
  automationUnitTopic,
} from "./automation-unit-queue.service";

export type AutomationUnitQueueFakeMessage = {
  readonly unitId: AutomationWorkUnitId;
  readonly idempotencyKey: string;
};

// Each publication maps to one fake message, so a message keeps its identity
// across reads and is decoded once.
const fakeMessages = new WeakMap<
  QueuePublication,
  AutomationUnitQueueFakeMessage
>();

const toFakeMessage = (
  publication: QueuePublication
): AutomationUnitQueueFakeMessage => {
  const known = fakeMessages.get(publication);
  if (known !== undefined) return known;
  const message = decodeStandardSchema(
    automationUnitTopic.message,
    publication.message
  );
  if (message === undefined) {
    throw new Error("The automation unit queue holds an invalid message");
  }
  const fakeMessage = {
    unitId: message.unitId,
    idempotencyKey: publication.options.idempotencyKey,
  };
  fakeMessages.set(publication, fakeMessage);
  return fakeMessage;
};

/**
 * The automation unit queue over an in-process queue. It records every
 * published message, drops a repeated idempotency key as the real queue
 * does, and lets a test deliver, redeliver, drop or duplicate pending
 * messages.
 */
export const makeAutomationUnitQueueFake = () => {
  const queue = makeMemoryQueue();
  const layer = AutomationUnitQueue.Default.pipe(Layer.provide(queue.layer));

  return {
    layer,
    /** Every message ever published, in order. */
    published: (): ReadonlyArray<AutomationUnitQueueFakeMessage> =>
      queue.published().map(toFakeMessage),
    /** Messages not yet taken, in delivery order. */
    pending: (): ReadonlyArray<AutomationUnitQueueFakeMessage> =>
      queue.pending().map(toFakeMessage),
    /** Removes and returns the next pending message. */
    take: () => {
      const publication = queue.take();
      return publication === undefined ? undefined : toFakeMessage(publication);
    },
    /** Puts a message back at the end, as a redelivery after a failure. */
    redeliver: (message: AutomationUnitQueueFakeMessage) => {
      const publication = {
        topic: automationUnitTopic.topic,
        message: { unitId: message.unitId },
        options: { idempotencyKey: message.idempotencyKey },
      };
      fakeMessages.set(publication, message);
      queue.redeliver(publication);
    },
    /** Loses every pending message, as an expired or lost publish. */
    dropPending: queue.dropPending,
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
