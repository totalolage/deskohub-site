import type { VercelConfig } from "@vercel/config/v1";
import { emailAutomationTickMinutes } from "./features/email-campaigns/automation/email-automation-cadence";

const queueTrigger = (topic: string) => ({
  type: "queue/v2beta" as const,
  topic,
  retryAfterSeconds: 60,
  initialDelaySeconds: 0,
});

export const config = {
  git: {
    deploymentEnabled: {
      main: false,
    },
  },
  routes: [
    {
      src: "^/(?:en-US|cs-CZ)(?:/(?:contact|faq|pricing|meeting-room|team|ttrpg-room|logo|terms-and-conditions|privacy-policy|cookie-policy|operating-rules|marketing-communications|reservation/cowork|reservation/meeting-room|reservation/office))?$",
      continue: true,
      transforms: [
        {
          type: "response.headers",
          op: "append",
          target: {
            key: "Vary",
          },
          args: "Accept",
        },
      ],
    },
  ],
  crons: [
    {
      path: "/api/cron/workspace/reservation-holds",
      schedule: "0 0 * * *",
    },
    {
      path: "/api/cron/workspace/auth-cleanup",
      schedule: "17 3 * * *",
    },
    // Each cron run wakes the production database. Minute zero is on every
    // engine tick, so the hourly refund poll shares its wake-up.
    {
      path: "/api/cron/workspace/payment-refunds",
      schedule: "0 * * * *",
    },
    {
      path: "/api/cron/workspace/paid-fulfillment",
      schedule: "57 5 * * *",
    },
    {
      path: "/api/cron/workspace/email-automations",
      schedule: `*/${emailAutomationTickMinutes} * * * *`,
    },
  ],
  functions: {
    "app/api/queues/workspace/email-campaign-send/route.ts": {
      experimentalTriggers: [queueTrigger("workspace-email-campaign-send")],
    },
    "app/api/queues/workspace/email-automation-unit/route.ts": {
      experimentalTriggers: [queueTrigger("workspace-email-automation-unit")],
    },
    "app/api/queues/workspace/late-payment-recovery/route.ts": {
      experimentalTriggers: [queueTrigger("workspace-late-payment-recovery")],
    },
    "app/api/queues/workspace/paid-fulfillment/route.ts": {
      experimentalTriggers: [queueTrigger("workspace-paid-fulfillment")],
    },
    "app/api/queues/workspace/reservation-hold-cleanup/route.ts": {
      experimentalTriggers: [
        queueTrigger("workspace-reservation-hold-cleanup"),
      ],
    },
  },
} satisfies VercelConfig;
