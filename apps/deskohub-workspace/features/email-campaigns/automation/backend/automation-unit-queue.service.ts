import { Context, Effect, Layer, Schema } from "effect";
import {
  type QueueMessageSendError,
  QueuePublisher,
} from "@/shared/backend/queue/queue-publisher";
import { defineQueueTopic } from "@/shared/backend/queue/queue-topic";
import { automationWorkUnitIdSchema } from "../automation-identifiers";
import type { EnqueuedAutomationUnit } from "./automation-unit-slots";

/**
 * Each enqueue generation is its own message, so the reaper's re-send of a
 * lost message isn't swallowed as a duplicate of the first.
 */
export const automationUnitTopic = defineQueueTopic({
  topic: "workspace-email-automation-unit",
  label: "Automation unit",
  message: Schema.toStandardSchemaV1(
    Schema.Struct({ unitId: automationWorkUnitIdSchema })
  ),
  publish: (unit: EnqueuedAutomationUnit) => ({
    message: { unitId: unit.unitId },
    key: `email-automation-unit:${unit.unitId}:${unit.enqueueGeneration}`,
  }),
});

interface IAutomationUnitQueue {
  /** Publishes one message per promoted unit, after its transaction commits. */
  readonly enqueue: (
    units: ReadonlyArray<EnqueuedAutomationUnit>
  ) => Effect.Effect<void, QueueMessageSendError>;
}

export class AutomationUnitQueue extends Context.Service<
  AutomationUnitQueue,
  IAutomationUnitQueue
>()("@deskohub-workspace/email-campaigns/AutomationUnitQueue") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const publisher = yield* QueuePublisher;
      return {
        enqueue: Effect.fn("automationUnitQueue.enqueue")(function* (units) {
          yield* Effect.all(
            units.map((unit) =>
              automationUnitTopic
                .publish(unit)
                .pipe(Effect.provideService(QueuePublisher, publisher))
            ),
            { concurrency: "inherit", discard: true }
          );
        }),
      };
    })
  );

  static Live = this.Default.pipe(Layer.provide(QueuePublisher.Default));
}
