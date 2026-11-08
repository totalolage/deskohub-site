import { DateTime, Effect, Option, Predicate } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import {
  accountAtom,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import {
  type ReservationGroups,
  reservationGroups,
} from "./reservation-list-model";
import { readSavedReservations, saveReservations } from "./reservations-cache";

/** What the Reservations list shows. */
export interface ReservationsList {
  readonly groups: ReservationGroups;
  /**
   * When the shown reservations were saved on this device, while the list
   * shows them instead of a fresh read (still loading, or the read failed);
   * none for a fresh read.
   */
  readonly savedAt: Option.Option<DateTime.Utc>;
}

/** The reservations saved on this device, grouped as of now. Read once. */
export const savedReservationsAtom = customerDataRuntime.atom(
  Effect.Do.pipe(
    Effect.bind("saved", () => readSavedReservations),
    Effect.bind("now", () => DateTime.now),
    Effect.map(({ saved, now }) =>
      Option.map(
        saved,
        ({ savedAt, history }): ReservationsList => ({
          groups: reservationGroups(history, now),
          savedAt: Option.some(savedAt),
        })
      )
    )
  )
);

/**
 * GET /reservations (Dotypos-backed), saved on this device on success. Read
 * on mount and on a manual refresh only. When the account turns out to need
 * linking, the account is read again so the tab's gate follows.
 */
export const reservationHistoryAtom = customerDataRuntime.atom((get) =>
  Effect.service(CustomerApi).pipe(
    Effect.flatMap((api) => api.reservations.listReservations({})),
    customerRead({ dotyposBacked: true }),
    Effect.tap(saveReservations),
    Effect.tapError((error) =>
      Effect.sync(() => get.refresh(accountAtom)).pipe(
        Effect.when(
          Effect.succeed(
            Predicate.isTagged(error, "CustomerAccountLinkRequired")
          )
        )
      )
    ),
    Effect.bindTo("history"),
    Effect.bind("now", () => DateTime.now),
    Effect.map(
      ({ history, now }): ReservationsList => ({
        groups: reservationGroups(history, now),
        savedAt: Option.none(),
      })
    )
  )
);

/**
 * Stale while revalidate: the fresh read once it has succeeded (kept under a
 * failed refresh); before that, the saved reservations while the read is
 * loading or after it failed, with the failure; else the read itself.
 */
export const reservationsListResult = <E>(
  saved: AsyncResult.AsyncResult<Option.Option<ReservationsList>, never>,
  fresh: AsyncResult.AsyncResult<ReservationsList, E>
): AsyncResult.AsyncResult<ReservationsList, E> => {
  if (Option.isSome(AsyncResult.value(fresh))) return fresh;
  const shown = Option.flatten(AsyncResult.value(saved));
  if (AsyncResult.isInitial(fresh)) {
    return Option.match(shown, {
      onNone: () => fresh,
      onSome: (list) => AsyncResult.success(list, { waiting: true }),
    });
  }
  if (AsyncResult.isFailure(fresh)) {
    return Option.match(shown, {
      onNone: () => fresh,
      onSome: (list) =>
        AsyncResult.failure(fresh.cause, {
          previousSuccess: Option.some(AsyncResult.success(list)),
          waiting: fresh.waiting,
        }),
    });
  }
  return fresh;
};

/** The Reservations list's data; refresh `reservationHistoryAtom` to reload. */
export const reservationsListAtom = Atom.make((get) =>
  reservationsListResult(
    get(savedReservationsAtom),
    get(reservationHistoryAtom)
  )
);
