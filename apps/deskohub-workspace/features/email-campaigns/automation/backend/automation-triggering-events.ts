import { and, asc, inArray, not, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { customerAccounts, customerEvents } from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { CustomerEventId } from "@/shared/backend/customer-events/customer-event";
import type { AutomationEngineTransaction } from "./automation-unit-handler";

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

/**
 * Locks the events' accounts `FOR SHARE`, in id order, and returns the
 * events that no longer trigger: an account marked legacy since intake read
 * them. Intake takes it once for all its events, before any lifecycle lock
 * (§5.4); it holds the marking back until the caller commits. The second
 * statement's fresh snapshot sees every marking committed before the grant.
 */
export const lockTriggeringCustomerEvents = (
  tx: AutomationEngineTransaction,
  events: readonly {
    readonly id: CustomerEventId;
    readonly customerAccountId: CustomerAccountId | null;
  }[]
) => {
  const accountIds = [
    ...new Set(
      events.flatMap(({ customerAccountId }) => customerAccountId ?? [])
    ),
  ].sort();
  const eventIds = events.flatMap(({ id, customerAccountId }) =>
    customerAccountId === null ? [] : [id]
  );
  return accountIds.length === 0
    ? Effect.succeed<ReadonlySet<CustomerEventId>>(new Set<CustomerEventId>())
    : tx
        .select({ id: customerAccounts.id })
        .from(customerAccounts)
        .where(inArray(customerAccounts.id, accountIds))
        .orderBy(asc(customerAccounts.id))
        .for("share")
        .pipe(
          Effect.andThen(
            tx
              .select({ id: customerEvents.id })
              .from(customerEvents)
              .where(
                and(
                  inArray(customerEvents.id, eventIds),
                  not(triggeringCustomerEvent)
                )
              )
          ),
          Effect.map(
            (rows): ReadonlySet<CustomerEventId> =>
              new Set(rows.map(({ id }) => id as CustomerEventId))
          )
        );
};
