import type { CustomerOrderStatus } from "@deskohub/workspace-customer-api";
import { Duration, Option } from "effect";

/**
 * The order statuses the site's status page refreshes on its own: payment or
 * confirmation is under way and normally finishes within minutes. Every other
 * status is final or asks the customer to wait longer, so it is refreshed
 * only on request.
 */
export const paymentReturnPollingStatuses: ReadonlySet<CustomerOrderStatus> =
  new Set<CustomerOrderStatus>([
    "pending",
    "paid_waiting_fulfillment",
    "paid_awaiting_delivery",
    "late_payment_checking",
  ]);

// Nine reads over about three minutes: frequent while the payment return is
// usually settling, then sparser, so the 40 account reads the account,
// history, status and access share per half hour keep room for the rest.
const delaysInSeconds = [3, 3, 5, 5, 10, 15, 20, 30, 60] as const;

// Automatic refreshes leave this many reads for what the customer does next.
const reservedReads = 8;

/**
 * How long to wait before the next automatic status read after the customer
 * returns from payment, or none when the screen should stop refreshing on its
 * own. `attempt` counts the automatic reads already made on this visit;
 * `remainingBudget` is the advisory number of status reads left.
 */
export const nextPaymentReturnPoll = (
  attempt: number,
  remainingBudget: number,
  status: CustomerOrderStatus
): Option.Option<Duration.Duration> => {
  const delay = delaysInSeconds[attempt];
  return delay === undefined ||
    remainingBudget < reservedReads ||
    !paymentReturnPollingStatuses.has(status)
    ? Option.none()
    : Option.some(Duration.seconds(delay));
};
