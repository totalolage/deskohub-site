import type { send } from "@vercel/queue";
import { Context, Effect, Layer, Schema } from "effect";
import {
  publishQueueMessage,
  type QueueMessageSendError,
} from "@/shared/backend/queue/queue-message";
import { automationWorkUnitIdSchema } from "../automation-identifiers";
import type { EnqueuedAutomationUnit } from "./automation-unit-slots";

export const automationUnitQueueTopic = "workspace-email-automation-unit";

export const automationUnitMessageSchema = Schema.Struct({
  unitId: automationWorkUnitIdSchema,
});
type AutomationUnitMessage = typeof automationUnitMessageSchema.Type;

interface IAutomationUnitQueue {
  /** Publishes one message per promoted unit, after its transaction commits. */
  readonly enqueue: (
    units: ReadonlyArray<EnqueuedAutomationUnit>
  ) => Effect.Effect<void, QueueMessageSendError>;
}

/**
 * Each enqueue generation is its own message, so the reaper's re-send of a
 * lost message isn't swallowed as a duplicate of the first.
 */
export const makeAutomationUnitQueue = (
  sendMessage?: typeof send
): IAutomationUnitQueue => ({
  enqueue: Effect.fn("automationUnitQueue.enqueue")(function* (units) {
    yield* Effect.all(
      units.map((unit) =>
        publishQueueMessage(
          automationUnitQueueTopic,
          { unitId: unit.unitId } satisfies AutomationUnitMessage,
          {
            idempotencyKey: `email-automation-unit:${unit.unitId}:${unit.enqueueGeneration}`,
          },
          sendMessage
        )
      ),
      { concurrency: "inherit", discard: true }
    );
  }),
});

export class AutomationUnitQueue extends Context.Service<
  AutomationUnitQueue,
  IAutomationUnitQueue
>()("@deskohub-workspace/email-campaigns/AutomationUnitQueue") {
  static Default = Layer.succeed(this, makeAutomationUnitQueue());
}
