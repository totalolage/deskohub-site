import { Clock, Context, Duration, Effect, Layer, Ref } from "effect";

/**
 * The server lets one account make 40 account reads per 30 minutes (the
 * account, the reservation history, an order's status and its door code
 * share them) and answers 429 after that. Consent, referrals and the invoice
 * spend a budget of their own. The app keeps its own advisory count so
 * automatic refreshes stop well before the customer's own taps hit the limit.
 */
export const accountReadAllowance = {
  reads: 40,
  window: Duration.minutes(30),
} as const;

/** Automatic refreshes run only while at least this many reads are left. */
export const automaticRefreshReserve = 8;

/** When each read in the current window was spent, oldest first. */
export type ReadBudgetWindow = ReadonlyArray<number>;

const windowMillis = Duration.toMillis(accountReadAllowance.window);

const liveReads = (window: ReadBudgetWindow, now: number) =>
  window.filter((spentAt) => now - spentAt < windowMillis);

export const spendRead = (
  window: ReadBudgetWindow,
  now: number
): ReadBudgetWindow => [...liveReads(window, now), now];

export const remainingReads = (window: ReadBudgetWindow, now: number) =>
  Math.max(0, accountReadAllowance.reads - liveReads(window, now).length);

export const allowsAutomaticRefresh = (remaining: number) =>
  remaining >= automaticRefreshReserve;

interface IAccountReadBudget {
  /** Counts one account read against the signed-in account. */
  readonly spend: Effect.Effect<void>;
  /** Reads left in the current window, as far as this app has counted. */
  readonly remaining: Effect.Effect<number>;
}

/**
 * The signed-in account's advisory read count. The data runtime is built per
 * account, so each account starts with its own window.
 */
export class AccountReadBudget extends Context.Service<
  AccountReadBudget,
  IAccountReadBudget
>()("AccountReadBudget") {
  static Default = Layer.effect(
    this,
    Effect.map(Ref.make<ReadBudgetWindow>([]), (window) => ({
      spend: Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Ref.update(window, (spent) => spendRead(spent, now))
      ),
      remaining: Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.map(Ref.get(window), (spent) => remainingReads(spent, now))
      ),
    }))
  );
}
