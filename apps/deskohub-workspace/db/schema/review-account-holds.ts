import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import type { CustomerAgentClientId } from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type {
  StoredWorkspaceReservationDetails,
  WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { customerAccounts } from "./customer-accounts";

/**
 * The simulated holds of app-directory review accounts. A review account's
 * booking never reaches Dotypos, Nexi, or `workspace_reservations`; it lands
 * here, so administration, revenue, fulfillment, and every cron and queue
 * that reads the reservation ledger never see it. The row holds no contact
 * details: only the product, interval, seats, and price the reviewer chose.
 *
 * `checkout_session_key` scopes supersession (a new selection in the same
 * checkout session, which an agent's is per account and client, cancels the
 * open hold), and `selection_key` makes a repeated selection return its open
 * hold. Both are SHA-256 digests of the checkout identifiers.
 */
export const reviewAccountHolds = pgTable(
  "review_account_holds",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<WorkspaceReservationId>(),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" })
      .$type<CustomerAccountId>(),
    agentClientId: text("agent_client_id").$type<CustomerAgentClientId>(),
    checkoutSessionKey: text("checkout_session_key").notNull(),
    selectionKey: text("selection_key").notNull(),
    reservationDetails: jsonb("reservation_details")
      .$type<StoredWorkspaceReservationDetails>()
      .notNull(),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    seats: integer("seats").notNull(),
    totalValue: integer("total_value").notNull(),
    totalExponent: integer("total_exponent").notNull(),
    currency: text("currency").notNull(),
    bookedAt: instant("booked_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    cancelledAt: instant("cancelled_at"),
  },
  (t) => [
    index("review_account_holds_account_session_idx").on(
      t.accountId,
      t.checkoutSessionKey
    ),
    check("review_account_holds_seats_check", sql`${t.seats} > 0`),
    check("review_account_holds_total_check", sql`${t.totalValue} >= 0`),
    check(
      "review_account_holds_interval_check",
      sql`${t.endsAt} > ${t.startsAt}`
    ),
    check(
      "review_account_holds_expiry_check",
      sql`${t.expiresAt} > ${t.bookedAt}`
    ),
  ]
);

export type ReviewAccountHold = typeof reviewAccountHolds.$inferSelect;
