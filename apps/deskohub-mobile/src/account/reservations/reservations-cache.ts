import {
  type CustomerReservationHistory,
  CustomerReservationSummary,
} from "@deskohub/workspace-customer-api";
import { DateTime, Duration, Effect, Option, Schema, Struct } from "effect";
import { AccountScopedStorage } from "../../customer-api/account-scoped-storage";

/**
 * The account's saved reservations on this device. The exit cleanup removes
 * it with the account's other entries (`exitClearedStoragePrefixes`).
 */
export const reservationsCacheName = "deskohub.reservations.v1";

/** How long saved reservations stay usable; older ones are dropped on read. */
export const reservationsCacheRetention = Duration.days(30);

// Only what the list shows: never the other party's name.
const savedReservationFields = [
  "id",
  "orderId",
  "product",
  "startsAt",
  "endsAt",
  "setupStartsAt",
  "seats",
  "status",
] as const;

/** A history reservation as the device keeps it. */
export const SavedReservation = Schema.Struct(
  Struct.pick(CustomerReservationSummary.fields, savedReservationFields)
);
export type SavedReservation = typeof SavedReservation.Type;

/** The history as the device keeps it, in the server's groups. */
export const SavedReservationHistory = Schema.Struct({
  current: Schema.Array(SavedReservation),
  past: Schema.Array(SavedReservation),
  unavailable: Schema.Array(SavedReservation),
});
export type SavedReservationHistory = typeof SavedReservationHistory.Type;

/** The last history the account read, and when it was read. */
export const SavedReservations = Schema.Struct({
  savedAt: Schema.DateTimeUtcFromMillis,
  history: SavedReservationHistory,
});
export type SavedReservations = typeof SavedReservations.Type;

const SavedReservationsJson = Schema.fromJsonString(SavedReservations);

const minimized = (
  history: CustomerReservationHistory
): SavedReservationHistory => {
  const keep = (row: CustomerReservationSummary): SavedReservation =>
    Struct.pick(row, savedReservationFields);
  return {
    current: history.current.map(keep),
    past: history.past.map(keep),
    unavailable: history.unavailable.map(keep),
  };
};

const isRetained =
  (now: DateTime.Utc) =>
  ({ savedAt }: SavedReservations) =>
    Duration.isLessThanOrEqualTo(
      DateTime.distance(savedAt, now),
      reservationsCacheRetention
    );

/**
 * The account's saved reservations, if any are readable and recent enough.
 * An unreadable or expired entry is removed; a device failure reads as none.
 */
export const readSavedReservations: Effect.Effect<
  Option.Option<SavedReservations>,
  never,
  AccountScopedStorage
> = Effect.Do.pipe(
  Effect.bind("storage", () => Effect.service(AccountScopedStorage)),
  Effect.bind("stored", ({ storage }) =>
    storage.getItem(reservationsCacheName)
  ),
  Effect.bind("now", () => DateTime.now),
  Effect.let("saved", ({ stored, now }) =>
    stored.pipe(
      Option.flatMap(Schema.decodeUnknownOption(SavedReservationsJson)),
      Option.filter(isRetained(now))
    )
  ),
  Effect.tap(({ storage, stored, saved }) =>
    storage
      .removeItem(reservationsCacheName)
      .pipe(
        Effect.when(
          Effect.succeed(Option.isSome(stored) && Option.isNone(saved))
        )
      )
  ),
  Effect.map(({ saved }) => saved),
  Effect.orElseSucceed(() => Option.none<SavedReservations>())
);

/**
 * Saves the history the account just read, minimized to what the list
 * shows. Saving is best effort: a failure leaves the previous entry. Once the
 * session has exited, nothing is written (`AccountScopedStorage`).
 */
export const saveReservations = (
  history: CustomerReservationHistory
): Effect.Effect<void, never, AccountScopedStorage> =>
  Effect.Do.pipe(
    Effect.bind("savedAt", () => DateTime.now),
    Effect.bind("text", ({ savedAt }) =>
      Schema.encodeEffect(SavedReservationsJson)({
        savedAt,
        history: minimized(history),
      })
    ),
    Effect.bind("storage", () => Effect.service(AccountScopedStorage)),
    Effect.flatMap(({ storage, text }) =>
      storage.setItem(reservationsCacheName, text)
    ),
    Effect.ignore({ log: "Warn", message: "Couldn't save reservations" })
  );
