import { handleCallback } from "@vercel/queue";
import { Effect } from "effect";
import { AutomationUnitProcessor } from "@/features/email-campaigns/automation/backend/automation-unit-processor.service";
import { processAutomationUnitMessage } from "@/features/email-campaigns/automation/backend/automation-unit-queue-consumer";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

export const maxDuration = 300;

const processMessage = defineWorkspaceTask(
  "emailAutomationUnitQueue",
  (message: Parameters<typeof processAutomationUnitMessage>[0]) =>
    processAutomationUnitMessage(message).pipe(
      Effect.asVoid,
      Effect.provide(AutomationUnitProcessor.Live)
    )
);

export const POST = handleCallback((message, _metadata) =>
  processMessage(message)
);
