import { Effect } from "effect";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import { AutomationUnitProcessor } from "./automation-unit-processor.service";

/**
 * Processes one queued unit. A redelivery failure fails the message, so the
 * queue retries it after 60 seconds while the unit keeps its slot.
 */
export const processAutomationUnitMessage = Effect.fn(
  "automationUnitQueue.processMessage"
)(function* (message: { readonly unitId: AutomationWorkUnitId }) {
  const processor = yield* AutomationUnitProcessor;
  return yield* processor.process(message.unitId);
});
