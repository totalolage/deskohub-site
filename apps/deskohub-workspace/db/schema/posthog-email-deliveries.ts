import type { EmailDeliveryId } from "@deskohub/email";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { quotedSqlList } from "./sql-list";

/**
 * PostHog's statuses of a sent email, plus `expired` for a delivery given up
 * on without a final status.
 */
export const postHogEmailDeliveryStatuses = [
  "queued",
  "sent",
  "failed",
  "delivered",
  "bounced",
  "complained",
  "expired",
] as const;
export type PostHogEmailDeliveryStatus =
  (typeof postHogEmailDeliveryStatuses)[number];

/**
 * Emails PostHog accepted, tracked until PostHog reports a final status,
 * because PostHog has no delivery-report webhook to push one.
 */
export const postHogEmailDeliveries = pgTable(
  "posthog_email_deliveries",
  {
    messageId: text("message_id").primaryKey().$type<EmailDeliveryId>(),
    category: text("category"),
    /** The provider tags a delivery report about this email carries. */
    tags: jsonb("tags").$type<Readonly<Record<string, string>>>().notNull(),
    status: text("status")
      .notNull()
      .default("queued")
      .$type<PostHogEmailDeliveryStatus>(),
    /** PostHog's reason for a failed status, or why the poll gave up. */
    reason: text("reason"),
    sentAt: instant("sent_at").notNull(),
    /** PostHog's time of the stored status. */
    statusAt: instant("status_at"),
    nextPollAt: instant("next_poll_at").notNull(),
    lastPolledAt: instant("last_polled_at"),
    pollCount: integer("poll_count").notNull().default(0),
    /** Set once the status is final or the delivery expired. */
    settledAt: instant("settled_at"),
  },
  (t) => [
    check(
      "posthog_email_deliveries_status_check",
      sql`${t.status} in (${quotedSqlList(postHogEmailDeliveryStatuses)})`
    ),
    index("posthog_email_deliveries_pending_idx")
      .on(t.nextPollAt)
      .where(sql`${t.settledAt} is null`),
  ]
);
