import { Effect } from "effect";
import { AutomationUnitProcessor } from "@/features/email-campaigns/automation/backend/automation-unit-processor.service";
import { processAutomationUnitMessage } from "@/features/email-campaigns/automation/backend/automation-unit-queue-consumer";
import { defineQueueConsumer } from "@/shared/backend/queue/queue-consumer";

export const maxDuration = 300;

export const POST = defineQueueConsumer("emailAutomationUnitQueue", (message) =>
  processAutomationUnitMessage(message).pipe(
    Effect.provide(AutomationUnitProcessor.Live)
  )
);
