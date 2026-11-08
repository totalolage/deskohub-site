import {
  type CustomerAccountDeletionResult,
  type CustomerAccountState,
  RequestCustomerAccountDeletion,
} from "@deskohub/workspace-customer-api";
import { Cause, Effect, Exit, Match, Option, Predicate, Schema } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import {
  accountAtom,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import { customerWrite } from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  viewErrorOf,
} from "../../customer-api/customer-view-error";
import { accountIndexModel } from "../account-gating";

/**
 * What the danger zone offers the account: deletion, a retry of the pending
 * deletion, or nothing (a review account, or deletion the API withholds),
 * as the Account tab's gates decide.
 */
export type DeletionOffer = "offered" | "pending" | "withheld";

export const deletionOffer = (account: CustomerAccountState): DeletionOffer => {
  const model = accountIndexModel(account);
  if (!model.sections.includes("danger")) return "withheld";
  return model.deletionPending ? "pending" : "offered";
};

const isUnconfirmed = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) &&
  Option.exists(Cause.findErrorOption(exit.cause), (error) =>
    Predicate.isTagged(error, "CustomerWriteUnconfirmed")
  );

/**
 * POST /account/deletion { confirmed: true }. Every outcome but `deleted`
 * (and an unconfirmed write) refetches the account, which may now show the
 * deletion pending. A deleted account is not refetched: its session is gone,
 * and the 401 would only race the sign-out that ends its registry.
 */
export const requestAccountDeletionAtom = customerDataRuntime.fn(
  (_: undefined, get) =>
    Effect.all([
      Schema.decodeEffect(RequestCustomerAccountDeletion)({
        confirmed: true,
      }),
      Effect.service(CustomerApi),
    ]).pipe(
      Effect.flatMap(([payload, api]) =>
        api.account.requestDeletion({ payload }).pipe(customerWrite)
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const accountRemains = Exit.isSuccess(exit)
            ? exit.value.status !== "deleted"
            : isUnconfirmed(exit);
          if (accountRemains) get.refresh(accountAtom);
        })
      ),
      Effect.withSpan("Account.requestDeletion")
    )
);

/** How one deletion attempt ended, as the danger zone shows it. */
export type DeletionAttempt =
  | { readonly kind: CustomerAccountDeletionResult["status"] }
  /** Sent, but the answer never arrived; the account was refetched. */
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "request-failed"; readonly error: CustomerViewError };

export const deletionAttemptOf = <E extends CustomerRequestFailure>(
  exit: Exit.Exit<CustomerAccountDeletionResult, E>
): DeletionAttempt =>
  Exit.match(exit, {
    onSuccess: ({ status }) => ({ kind: status }),
    onFailure: (cause) => {
      const error = viewErrorOf(cause);
      return error._tag === "Unconfirmed"
        ? { kind: "unconfirmed" }
        : { kind: "request-failed", error };
    },
  });

/**
 * What follows an attempt: where its outcome shows, and what the screen does
 * next. The dialog keeps the outcomes the customer acts on from there
 * (retry, reauthenticate, the sign-out under way); a refusal is final and an
 * unconfirmed attempt is answered by the refetched account, so both close
 * the dialog and show on the screen. A deleted account leaves; a stale
 * sign-in asks the customer to confirm it's them, then to delete again.
 */
export interface DeletionFollowUp {
  readonly shownIn: "dialog" | "screen";
  readonly next: "leave" | "reauthenticate" | "none";
}

export const deletionFollowUp = (attempt: DeletionAttempt): DeletionFollowUp =>
  Match.value(attempt).pipe(
    Match.discriminatorsExhaustive("kind")({
      deleted: () => ({ shownIn: "dialog", next: "leave" }) as const,
      "reauthentication-required": () =>
        ({ shownIn: "dialog", next: "reauthenticate" }) as const,
      failed: () => ({ shownIn: "dialog", next: "none" }) as const,
      "request-failed": () => ({ shownIn: "dialog", next: "none" }) as const,
      refused: () => ({ shownIn: "screen", next: "none" }) as const,
      unconfirmed: () => ({ shownIn: "screen", next: "none" }) as const,
    })
  );

export interface DangerZoneView {
  readonly offer: DeletionOffer;
  /** The delete (or retry) button, enabled once the customer has confirmed. */
  readonly deleteAction: "hidden" | "disabled" | "enabled";
}

/**
 * The danger zone for the account, the confirmation checkbox and the last
 * attempt: deletion needs the explicit confirmation, and a refusal ends it
 * for this visit (the server changed nothing and won't).
 */
export const dangerZoneView = (
  account: CustomerAccountState,
  {
    confirmed,
    attempt,
  }: {
    readonly confirmed: boolean;
    readonly attempt: DeletionAttempt | undefined;
  }
): DangerZoneView => {
  const offer = deletionOffer(account);
  if (offer === "withheld") return { offer, deleteAction: "hidden" };
  const enabled = confirmed && attempt?.kind !== "refused";
  return { offer, deleteAction: enabled ? "enabled" : "disabled" };
};

/**
 * Whether the dialog may send the deletion now: the account was read afresh
 * (not still refetching after the last attempt, not failing) and its gates
 * still offer deletion with the customer's confirmation.
 */
export const deletionSubmittable = (
  account: AsyncResult.AsyncResult<CustomerAccountState, unknown>,
  choice: {
    readonly confirmed: boolean;
    readonly attempt: DeletionAttempt | undefined;
  }
) =>
  AsyncResult.isSuccess(account) &&
  !account.waiting &&
  dangerZoneView(account.value, choice).deleteAction === "enabled";
