import type {
  CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { Cause, Effect, Option, Stream } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import { Clipboard } from "../../customer-api/device-capabilities";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { accessWindowStates } from "./access-clock";
import { type AccessWindowState, accessWindowOf } from "./access-window";

/**
 * An order's door PIN and the lock's window (GET access, Dotypos-backed).
 * The PIN lives only in this atom's memory: nothing writes it to storage,
 * and it goes with the atom when the screen unmounts.
 */
export const reservationAccessAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.atom(
      Effect.flatMap(Effect.service(CustomerApi), (api) =>
        api.reservations.getReservationAccess({ params: { orderId } })
      ).pipe(customerRead({ accountRead: true }))
    )
);

/**
 * The lock's window as the access answer gives it, as an atom key: plain
 * objects compare structurally, so the same window finds the same atom.
 */
export const accessWindowKey = ({
  accessStartsAt,
  accessEndsAt,
}: Pick<CustomerReservationAccess, "accessStartsAt" | "accessEndsAt">) => ({
  accessStartsAt,
  accessEndsAt,
});

/**
 * Where a window stands, every second while the screen is mounted, until it
 * ends; none for a window whose times can't be read. Keyed by the window
 * on screen rather than the read, so a failed refresh that keeps the last
 * PIN on screen keeps its countdown running too.
 */
export const accessCountdownAtom = Atom.family(
  (window: ReturnType<typeof accessWindowKey>) =>
    customerDataRuntime.atom(
      Option.match(accessWindowOf(window), {
        onNone: () => Stream.make(Option.none<AccessWindowState>()),
        onSome: (parsed) => Stream.map(accessWindowStates(parsed), Option.some),
      })
    )
);

/**
 * Copies the PIN on screen, kept out of the system's clipboard preview.
 * One copy result per order.
 */
export const copyAccessCodeAtom = Atom.family(
  (_orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn((code: string) =>
      Effect.flatMap(Effect.service(Clipboard), (clipboard) =>
        clipboard.copy(code, { sensitive: true })
      )
    )
);

const withdrawsAccess = (error: CustomerViewError) =>
  error._tag === "NotFound" || error._tag === "AccessCodeUnavailable";

/**
 * The access read as the screen shows it. A failure normally keeps the last
 * PIN on screen under a notice, but a refresh that finds the order gone or
 * its PIN withdrawn drops it: the screen must not keep showing a PIN the
 * server no longer vouches for.
 */
export const shownAccess = <A, E extends CustomerRequestFailure>(
  result: AsyncResult.AsyncResult<A, E>
): AsyncResult.AsyncResult<A, E> =>
  AsyncResult.isFailure(result) &&
  Option.exists(Cause.findErrorOption(result.cause), (failure) =>
    withdrawsAccess(toCustomerViewError(failure))
  )
    ? AsyncResult.failure(result.cause, { waiting: result.waiting })
    : result;

/** The access screen's own copy for the failures only it can explain. */
export const accessErrorMessage = (
  error: CustomerViewError,
  locale: AppLocale
): string | undefined =>
  (
    ({
      NotFound: m.reservations_access_not_found,
      AccessCodeUnavailable: m.reservations_access_unavailable,
    }) as Partial<
      Record<CustomerViewError["_tag"], typeof m.reservations_access_not_found>
    >
  )[error._tag]?.({}, { locale });
