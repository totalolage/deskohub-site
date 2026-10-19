import { Effect, Option, Schema } from "effect";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";
import { automationUnitMessageSchema } from "./automation-unit-queue.service";

const decodeMessage = Schema.decodeUnknownOption(automationUnitMessageSchema);

/**
 * Processes one queued unit. A redelivery failure fails the message, so the
 * queue retries it after 60 seconds while the unit keeps its slot.
 */
export const processAutomationUnitMessage = Effect.fn(
  "automationUnitQueue.processMessage"
)(function* (message: Parameters<typeof decodeMessage>[0]) {
  const payload = Option.getOrUndefined(decodeMessage(message));
  if (!payload) {
    yield* Effect.logWarning(
      "Automation unit queue message ignored: invalid payload"
    );
    return "ignored" as const;
  }

  const processor = yield* AutomationUnitProcessor;
  return yield* processor.process(payload.unitId);
});
