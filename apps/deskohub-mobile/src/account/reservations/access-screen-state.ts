import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { Effect, Option, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import { customerRead } from "../../customer-api/customer-request";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import { Clipboard } from "../../customer-api/device-capabilities";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { accessWindowStates } from "./access-clock";
import { accessWindowOf } from "./access-window";

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
      ).pipe(customerRead({ dotyposBacked: true }))
    )
);

/**
 * Where the order's access window stands, every second while the screen
 * is mounted, until the window ends. Emits nothing for a window whose times
 * can't be read.
 */
export const accessCountdownAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.atom((get) =>
      Stream.unwrap(
        Effect.map(get.result(reservationAccessAtom(orderId)), (access) =>
          Option.match(accessWindowOf(access), {
            onNone: () => Stream.empty,
            onSome: accessWindowStates,
          })
        )
      )
    )
);

/** Copies the order's PIN, kept out of the system's clipboard preview. */
export const copyAccessCodeAtom = Atom.family(
  (orderId: CustomerReservationOrderId) =>
    customerDataRuntime.fn((_: undefined, get) =>
      Effect.flatMap(
        Effect.all({
          access: get.result(reservationAccessAtom(orderId)),
          clipboard: Effect.service(Clipboard),
        }),
        ({ access, clipboard }) =>
          clipboard.copy(access.code, { sensitive: true })
      )
    )
);

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
