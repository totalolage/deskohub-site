import type { CustomerOrderStatus } from "@deskohub/workspace-customer-api";
import { Data, Duration, Option } from "effect";
import {
  nextPaymentReturnPoll,
  paymentReturnPollingStatuses,
} from "../../booking/payment-return-polling";
import { allowsAutomaticRefresh } from "../../customer-api/account-read-budget";

/**
 * How the customer reached the status screen: straight from payment
 * (`?after=payment`), when the order usually settles within moments, or any
 * other way.
 */
export type StatusVisit = "normal" | "after-payment";

/** The visit a route's `after` search param names; anything else is normal. */
export const statusVisitOf = (
  after: string | ReadonlyArray<string> | undefined
): StatusVisit => (after === "payment" ? "after-payment" : "normal");

/** A normal visit refreshes a settling order at most three times. */
export const normalRefreshDelays: ReadonlyArray<Duration.Duration> = [
  Duration.seconds(10),
  Duration.seconds(20),
  Duration.seconds(40),
];

/**
 * Whether a read that found the order in `status` settled it: the status is
 * one the screen doesn't refresh on its own, and differs from the status the
 * screen last showed (`previous`), whether that one was settling or, like a
 * delayed confirmation, waiting longer. When the screen hasn't shown the
 * order yet, only a visit after payment counts: the order was settling when
 * the customer left for payment. Other views of the order, read before, are
 * then out of date.
 */
export const readSettlesOrder = ({
  visit,
  previous,
  status,
}: {
  readonly visit: StatusVisit;
  readonly previous: Option.Option<CustomerOrderStatus>;
  readonly status: CustomerOrderStatus;
}): boolean =>
  !paymentReturnPollingStatuses.has(status) &&
  Option.match(previous, {
    onNone: () => visit === "after-payment",
    onSome: (shown) => shown !== status,
  });

/** Why the screen no longer refreshes on its own. */
export type AutomaticRefreshStop =
  /** The order's status is one the site doesn't refresh automatically. */
  | "settled"
  /** Too few reads are left for what the customer does next. */
  | "budget"
  /** The visit's automatic reads are used up. */
  | "exhausted"
  /** The server answered 429. */
  | "limited"
  /** An automatic read failed otherwise. */
  | "failed";

export type AutomaticRefresh = Data.TaggedEnum<{
  After: { readonly delay: Duration.Duration };
  Stopped: { readonly reason: AutomaticRefreshStop };
}>;
export const AutomaticRefresh = Data.taggedEnum<AutomaticRefresh>();

const scheduledDelay = (
  visit: StatusVisit,
  attempt: number,
  remainingBudget: number,
  status: CustomerOrderStatus
): Option.Option<Duration.Duration> =>
  ({
    normal: () => Option.fromUndefinedOr(normalRefreshDelays[attempt]),
    "after-payment": () =>
      nextPaymentReturnPoll(attempt, remainingBudget, status),
  })[visit]();

/**
 * When the screen reads the order again on its own, or why it stops.
 * `attempt` counts the automatic reads already made since the screen came
 * into view; `remainingBudget` is the advisory number of reads left.
 */
export const nextAutomaticRefresh = ({
  visit,
  attempt,
  remainingBudget,
  status,
}: {
  readonly visit: StatusVisit;
  readonly attempt: number;
  readonly remainingBudget: number;
  readonly status: CustomerOrderStatus;
}): AutomaticRefresh => {
  if (!paymentReturnPollingStatuses.has(status)) {
    return AutomaticRefresh.Stopped({ reason: "settled" });
  }
  if (!allowsAutomaticRefresh(remainingBudget)) {
    return AutomaticRefresh.Stopped({ reason: "budget" });
  }
  return Option.match(scheduledDelay(visit, attempt, remainingBudget, status), {
    onNone: () => AutomaticRefresh.Stopped({ reason: "exhausted" }),
    onSome: (delay) => AutomaticRefresh.After({ delay }),
  });
};
