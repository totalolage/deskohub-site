import { handleCallback } from "@vercel/queue";
import { Effect } from "effect";
import {
  PaidFulfillmentWorkerLiveWithDependencies,
  processPaidFulfillmentQueueMessage,
} from "@/features/checkout/backend/fulfillment";
import { defineWorkspaceTask } from "@/shared/backend/workspace-effect";

const processMessage = defineWorkspaceTask(
  "paidFulfillmentQueue",
  (message: Parameters<typeof processPaidFulfillmentQueueMessage>[0]) =>
    processPaidFulfillmentQueueMessage(message).pipe(
      Effect.asVoid,
      Effect.provide(PaidFulfillmentWorkerLiveWithDependencies)
    )
);

export const POST = handleCallback((message, _metadata) =>
  processMessage(message)
);
