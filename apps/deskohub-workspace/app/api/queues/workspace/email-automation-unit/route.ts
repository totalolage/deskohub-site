import { Effect } from "effect";
import { AutomationUnitProcessor } from "@/features/email-campaigns/automation/backend/automation-unit-processor.service";
import { automationUnitTopic } from "@/features/email-campaigns/automation/backend/automation-unit-queue.service";
import { processAutomationUnitMessage } from "@/features/email-campaigns/automation/backend/automation-unit-queue-consumer";

export const maxDuration = 300;

export const POST = automationUnitTopic.consume(
  "emailAutomationUnitQueue",
  (message) =>
    processAutomationUnitMessage(message).pipe(
      Effect.provide(AutomationUnitProcessor.Live)
    )
);
