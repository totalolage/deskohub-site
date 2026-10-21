import { type SQL, sql } from "drizzle-orm";
import { customerAccounts, customerEvents } from "@/db/schema";

/**
 * Whether a `customer_events` row can start a run: every event except a
 * legacy account's `account-created`. An existing customer's account is
 * never a new one (D37), yet the capture reconciler before it skipped
 * legacy accounts recorded events for them, and a deployment still running
 * that code can record more. Live intake and the dry run's replay both read
 * events through this, so neither ever takes one in.
 */
export const triggeringCustomerEvent: SQL<boolean> = sql<boolean>`not exists (
  select 1 from ${customerAccounts}
  where ${customerAccounts.id} = ${customerEvents.customerAccountId}
    and ${customerAccounts.legacy}
)`;
