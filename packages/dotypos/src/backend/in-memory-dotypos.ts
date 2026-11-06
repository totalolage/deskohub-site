import { Clock, Effect, Layer, Match, Option, Schema } from "effect";
import {
  type DotyposOperation,
  type DotyposReadFailure,
  DotyposRejected,
  type DotyposRequest,
  DotyposReservationCancelledError,
} from "../errors";
import { formatDotyposTimestamp } from "../timestamp";
import {
  type CreateDotyposReservationInput,
  type DotyposBranchId,
  DotyposBranchIdSchema,
  type DotyposCloudId,
  DotyposCloudIdSchema,
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  type DotyposDiscountGroup,
  DotyposDiscountGroupIdSchema,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  type DotyposReservationInterval,
  type DotyposTable,
  DotyposTableIdSchema,
} from "../types";
import {
  dotyposInvalidRequest,
  dotyposInvalidResponse,
} from "./failure-classification";
import { readByIds } from "./id-reads";
import {
  DotyposService,
  dotyposMaximumPageSize,
  type IDotyposService,
  type ReservationListOptions,
  type ReservationPage,
  reservationListQuery,
  validateReservationInterval,
  validateReservationPageNumber,
} from "./service";

/** What Dotypos holds when the fake starts. */
export type InMemoryDotyposSeed = {
  readonly customers?: Iterable<DotyposCustomer>;
  readonly reservations?: Iterable<DotyposReservation>;
  readonly tables?: readonly DotyposTable[];
  readonly discountGroups?: readonly DotyposDiscountGroup[];
};

/** One request the fake answers, as `onRequest` sees it. */
export type InMemoryDotyposRequest = {
  readonly operation: DotyposOperation;
  /** The batch an ID read requests. */
  readonly ids?: readonly string[];
};

export type InMemoryDotyposOptions = {
  readonly cloudId?: DotyposCloudId;
  readonly branchId?: DotyposBranchId;
  /**
   * Runs before each request the fake answers, after input validation:
   * once per operation call, and once per batch of `dotyposIdReadBatchSize`
   * for ID reads, as production sends them. A failure fails that request
   * (an ID batch with `onBatchFailure` recovers it), and nothing is
   * applied. Use it for request counts, latency or gating; fail a whole
   * operation by overriding it with `DotyposServiceMock` instead.
   */
  readonly onRequest?: (
    request: InMemoryDotyposRequest
  ) => Effect.Effect<void, DotyposReadFailure>;
};

/**
 * A stateful in-memory `DotyposService` for tests. Writes change what later
 * reads return, so assert a write by reading it back.
 *
 * It models what callers rely on: ID lookups and ID reads (deleted
 * customers included, the operational batch size, invalid ID rejection,
 * per-batch failure recovery), the customer, start-time and order filters,
 * 100-record pages, the active-overlap filter, a new `versionDate` on every
 * write (same-value writes included), and the reservation status
 * transitions of create, confirm and cancel. Missing records answer as
 * production does: `Option.none()` or `DotyposRejected{not-found}`.
 *
 * It never produces transport outcomes, version conflicts or uncertain
 * writes; inject them by spreading `service` into `DotyposServiceMock` with
 * an override. It models only the agreed behavior, not live Dotypos:
 * operations it does not model (customer search, lookup, creation and
 * details writes, products, categories, change listings) die naming the
 * operation.
 */
export const makeInMemoryDotypos = (
  seed: InMemoryDotyposSeed = {},
  options: InMemoryDotyposOptions = {}
) => {
  const cloudId = options.cloudId ?? DotyposCloudIdSchema.make("in-memory");
  const branchId = options.branchId ?? DotyposBranchIdSchema.make("in-memory");
  const customers = new Map<DotyposCustomerId, DotyposCustomer>(
    Array.from(seed.customers ?? [], (customer) => [customer.id, customer])
  );
  const reservations = new Map<DotyposReservationId, DotyposReservation>(
    Array.from(seed.reservations ?? [], (reservation) => [
      reservation.id,
      reservation,
    ])
  );
  const tables = [...(seed.tables ?? [])];
  const discountGroups = [...(seed.discountGroups ?? [])];
  let lastVersion = BigInt(0);
  let nextReservationNumber = 9_000_000_000_000;

  const request = (
    operation: DotyposOperation,
    ids?: readonly string[]
  ): Effect.Effect<void, DotyposReadFailure> =>
    options.onRequest?.(ids ? { operation, ids } : { operation }) ??
    Effect.void;

  /** A Dotypos timestamp later than every earlier version. */
  const nextVersion = Clock.currentTimeMillis.pipe(
    Effect.map((now) => {
      const at = BigInt(now) * BigInt(1000);
      lastVersion = at > lastVersion ? at : lastVersion + BigInt(1);
      return formatDotyposTimestamp(lastVersion);
    })
  );

  const notFound = (
    operation: DotyposOperation,
    dotyposRequest: DotyposRequest
  ) =>
    new DotyposRejected({
      operation,
      request: dotyposRequest,
      reason: "not-found",
      message: "The in-memory Dotypos holds no such record.",
    });

  const normalizeId = <A>(
    schema: Schema.Decoder<A>,
    value: string,
    label: string,
    operation: DotyposOperation
  ) =>
    Schema.decodeUnknownEffect(schema)(value.trim()).pipe(
      Effect.mapError((cause) =>
        dotyposInvalidRequest(operation, `${label} is required`, cause)
      )
    );

  const selectReservations = (selection: ReservationListOptions) => {
    const startsAtOrAfter = parseInstant(selection.startsAtOrAfter);
    const startsBefore = parseInstant(selection.startsBefore);
    const selected = [...reservations.values()].filter((reservation) => {
      const startsAt = Date.parse(reservation.startDate);
      return (
        (!selection.customerId ||
          reservation._customerId === selection.customerId) &&
        (startsAtOrAfter === undefined || startsAt >= startsAtOrAfter) &&
        (startsBefore === undefined || startsAt < startsBefore)
      );
    });
    if (!selection.order) return selected;
    const direction = selection.order === "startDateAscending" ? 1 : -1;
    return selected.toSorted(
      (left, right) =>
        direction * (Date.parse(left.startDate) - Date.parse(right.startDate))
    );
  };

  const selectActiveReservations = (interval: DotyposReservationInterval) =>
    [...reservations.values()].filter(
      (reservation) =>
        (reservation.status === "NEW" || reservation.status === "CONFIRMED") &&
        Date.parse(reservation.startDate) < interval.endDate.getTime() &&
        Date.parse(reservation.endDate) > interval.startDate.getTime()
    );

  const readReservationRecord = (
    id: DotyposReservationId,
    operation: DotyposOperation,
    dotyposRequest: DotyposRequest
  ) =>
    normalizeId(
      DotyposReservationIdSchema,
      id,
      "Reservation ID",
      operation
    ).pipe(
      Effect.tap(() => request(operation)),
      Effect.flatMap((reservationId) => {
        const reservation = reservations.get(reservationId);
        return reservation
          ? Effect.succeed(reservation)
          : Effect.fail(notFound(operation, dotyposRequest));
      })
    );

  /** Replaces a stored reservation with `change` applied under a new version. */
  const writeReservation = (
    reservation: DotyposReservation,
    change: Partial<DotyposReservation>
  ) =>
    nextVersion.pipe(
      Effect.map((versionDate) => {
        const written = { ...reservation, ...change, versionDate };
        reservations.set(written.id, written);
        return written;
      })
    );

  /** Applies `change` to a stored customer under a new version; none when it is missing. */
  const writeCustomer = (
    customerId: DotyposCustomerId,
    operation: DotyposOperation,
    change: (customer: DotyposCustomer) => Partial<DotyposCustomer>
  ) =>
    request(operation).pipe(
      Effect.andThen(nextVersion),
      Effect.map((versionDate) =>
        Option.map(
          Option.fromUndefinedOr(customers.get(customerId)),
          (stored) => {
            const written = { ...stored, ...change(stored), versionDate };
            customers.set(written.id, written);
            return written;
          }
        )
      )
    );

  const service: IDotyposService = {
    listCustomerChanges: unsupported("listCustomerChanges"),
    searchCustomers: unsupported("searchCustomers"),
    findCustomer: unsupported("findCustomer"),
    findOrCreateCustomer: unsupported("findOrCreateCustomer"),
    createCustomer: unsupported("createCustomer"),
    patchCustomer: unsupported("patchCustomer"),
    updateCustomerBillingDetails: unsupported("updateCustomerBillingDetails"),
    updateCustomerDetails: unsupported("updateCustomerDetails"),
    updateCustomerProfile: unsupported("updateCustomerProfile"),
    getProducts: unsupported("getProducts"),
    getCategories: unsupported("getCategories"),

    getReservation: (id) =>
      readReservationRecord(id, "getReservation", "reservation.get").pipe(
        Effect.flatMap((reservation) => {
          if (!reservation._customerId) {
            return Effect.fail(
              dotyposInvalidResponse(
                { operation: "getReservation", request: "reservation.get" },
                { message: `Reservation ${reservation.id} has no customer ID` }
              )
            );
          }
          const customer = customers.get(reservation._customerId);
          return customer
            ? Effect.succeed(Option.some({ reservation, customer }))
            : Effect.fail(notFound("getReservation", "customer.get"));
        }),
        Effect.catchIf(
          (failure) =>
            failure.reason === "not-found" &&
            failure.request === "reservation.get",
          () => Effect.succeed(Option.none())
        )
      ),
    getReservationWithoutCustomer: (id) =>
      readReservationRecord(
        id,
        "getReservationWithoutCustomer",
        "reservation.get"
      ),
    getReservationStatus: (id) =>
      readReservationRecord(
        id,
        "getReservationStatus",
        "reservation.status"
      ).pipe(Effect.map((reservation) => reservation.status)),
    getCustomer: (id) =>
      request("getCustomer").pipe(
        Effect.andThen(
          Effect.sync(() => Option.fromUndefinedOr(customers.get(id)))
        )
      ),
    getCustomersByIds: (ids, readOptions) =>
      readByIds(
        ids,
        "getCustomersByIds",
        (batch) =>
          request("getCustomersByIds", batch).pipe(
            Effect.andThen(
              Effect.sync(() => {
                const selected = new Set<string>(batch);
                return [...customers.values()].filter((customer) =>
                  selected.has(customer.id)
                );
              })
            )
          ),
        readOptions
      ),
    getReservationsByIds: (ids, readOptions = {}) =>
      readByIds(
        ids,
        "getReservationsByIds",
        (batch) =>
          reservationListQuery(readOptions, "getReservationsByIds").pipe(
            Effect.andThen(request("getReservationsByIds", batch)),
            Effect.andThen(
              Effect.sync(() => {
                const selected = new Set<string>(batch);
                return selectReservations(readOptions).filter((reservation) =>
                  selected.has(reservation.id)
                );
              })
            )
          ),
        readOptions
      ),
    getCustomerDiscountGroup: ({ customerId }) =>
      normalizeId(
        DotyposCustomerIdSchema,
        customerId,
        "Customer ID",
        "getCustomerDiscountGroup"
      ).pipe(
        Effect.tap(() => request("getCustomerDiscountGroup")),
        Effect.flatMap((id) => {
          const customer = customers.get(id);
          if (!customer) {
            return Effect.fail(
              notFound("getCustomerDiscountGroup", "customer.get")
            );
          }
          const discountGroupId = customer._discountGroupId;
          if (!discountGroupId) return Effect.succeed(undefined);
          const group = discountGroups.find(
            (candidate) => candidate.id === discountGroupId
          );
          return group
            ? Effect.succeed({
                discountGroupId,
                discountPercent: group.discountPercent,
              })
            : Effect.fail(
                notFound("getCustomerDiscountGroup", "discountGroup.get")
              );
        })
      ),
    getDiscountGroups: () =>
      request("getDiscountGroups").pipe(Effect.as(discountGroups)),
    getTables: () => request("getTables").pipe(Effect.as(tables)),
    listReservations: (selection = {}) =>
      reservationListQuery(selection, "listReservations").pipe(
        Effect.andThen(request("listReservations")),
        Effect.andThen(Effect.sync(() => selectReservations(selection)))
      ),
    listReservationsPage: ({ page, ...selection }) =>
      validateReservationPageNumber(page, "listReservationsPage").pipe(
        Effect.andThen(reservationListQuery(selection, "listReservationsPage")),
        Effect.andThen(request("listReservationsPage")),
        Effect.andThen(
          Effect.sync(() => pageOf(selectReservations(selection), page))
        )
      ),
    listActiveReservationsPage: (interval, page) =>
      validateReservationPageNumber(page, "listActiveReservationsPage").pipe(
        Effect.andThen(
          validateReservationInterval(interval, "listActiveReservationsPage")
        ),
        Effect.andThen(request("listActiveReservationsPage")),
        Effect.andThen(
          Effect.sync(() => pageOf(selectActiveReservations(interval), page))
        )
      ),
    listActiveReservationsOverlapping: (interval) =>
      validateReservationInterval(
        interval,
        "listActiveReservationsOverlapping"
      ).pipe(
        Effect.andThen(request("listActiveReservationsOverlapping")),
        Effect.andThen(Effect.sync(() => selectActiveReservations(interval)))
      ),

    createReservation: (input) =>
      validateCreateReservation(input).pipe(
        Effect.tap(() => request("createReservation")),
        Effect.andThen(nextVersion),
        Effect.map((version) => {
          let id = DotyposReservationIdSchema.make(
            String(nextReservationNumber++)
          );
          while (reservations.has(id)) {
            id = DotyposReservationIdSchema.make(
              String(nextReservationNumber++)
            );
          }
          const note = input.note?.trim();
          const created: DotyposReservation = {
            id,
            _branchId: branchId,
            _cloudId: cloudId,
            _customerId: DotyposCustomerIdSchema.make(input.customerId.trim()),
            _tableId: DotyposTableIdSchema.make(input.tableId.trim()),
            startDate: input.startDate.toISOString(),
            endDate: input.endDate.toISOString(),
            seats: String(input.seats),
            status: input.status,
            flags: "0",
            created: version,
            versionDate: version,
            ...(note && { note }),
          };
          reservations.set(id, created);
          return created;
        })
      ),
    cancelReservation: (reservationId) =>
      readReservationRecord(
        reservationId,
        "cancelReservation",
        "reservation.delete"
      ).pipe(
        Effect.flatMap((reservation) =>
          writeReservation(reservation, { status: "CANCELLED" })
        ),
        Effect.asVoid
      ),
    confirmReservation: (reservationId) =>
      readReservationRecord(
        reservationId,
        "confirmReservation",
        "reservation.version"
      ).pipe(
        Effect.flatMap((reservation) =>
          Match.value(reservation.status).pipe(
            Match.when("CANCELLED", () =>
              Effect.fail(
                new DotyposReservationCancelledError({
                  reservationId: reservation.id,
                  message: "Dotypos reservation is already cancelled.",
                })
              )
            ),
            Match.when("CONFIRMED", () => Effect.succeed(reservation)),
            Match.when("NEW", () =>
              writeReservation(reservation, { status: "CONFIRMED" })
            ),
            Match.exhaustive
          )
        )
      ),
    updateReservation: ({ reservationId, note }) => {
      const trimmed = note.trim();
      return trimmed
        ? readReservationRecord(
            reservationId,
            "updateReservation",
            "reservation.version"
          ).pipe(
            Effect.flatMap((reservation) =>
              writeReservation(reservation, { note: trimmed })
            )
          )
        : Effect.fail(
            dotyposInvalidRequest(
              "updateReservation",
              "Reservation note is required"
            )
          );
    },
    setCustomerDiscountGroup: (customerId, discountGroupId) =>
      Effect.gen(function* () {
        const normalized = discountGroupId
          ? yield* normalizeId(
              DotyposDiscountGroupIdSchema,
              discountGroupId,
              "Discount group ID",
              "setCustomerDiscountGroup"
            )
          : null;
        const written = yield* writeCustomer(
          customerId,
          "setCustomerDiscountGroup",
          () => ({ _discountGroupId: normalized })
        );
        if (Option.isNone(written)) {
          return yield* notFound(
            "setCustomerDiscountGroup",
            "customer.version"
          );
        }
        return written.value;
      }),
    expireCustomer: (customerId) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          writeCustomer(customerId, "expireCustomer", () => ({
            expireDate: new Date(
              now - customerExpiryLeadMilliseconds
            ).toISOString(),
          }))
        )
      ),
    reactivateCustomer: (customerId) =>
      writeCustomer(customerId, "reactivateCustomer", () => ({
        expireDate: null,
      })),
  };

  return {
    service,
    layer: Layer.succeed(DotyposService, service),
    /**
     * The customers Dotypos holds, by id. Change them directly to model an
     * edit made outside Workspace, such as staff working in Dotypos.
     */
    customers,
    /** The reservations Dotypos holds, by id; change them like `customers`. */
    reservations,
  };
};

export type InMemoryDotypos = ReturnType<typeof makeInMemoryDotypos>;

/** How far in the past expireCustomer sets the expiry, as production does. */
const customerExpiryLeadMilliseconds = 60_000;

/** An operation the fake does not model; it dies naming the operation. */
const unsupported = (operation: DotyposOperation) => () =>
  Effect.die(
    new Error(
      `The in-memory Dotypos does not model ${operation}. Override it with DotyposServiceMock({ ...dotypos.service, ${operation}: ... }).`
    )
  );

const validateCreateReservation = (input: CreateDotyposReservationInput) =>
  Effect.gen(function* () {
    for (const [value, label] of [
      [input.customerId, "Customer ID"],
      [input.tableId, "Table ID"],
    ] as const) {
      if (!value.trim()) {
        return yield* dotyposInvalidRequest(
          "createReservation",
          `${label} is required`
        );
      }
    }
    if (!Number.isInteger(input.seats) || input.seats <= 0) {
      return yield* dotyposInvalidRequest(
        "createReservation",
        "Reservation seats must be a positive integer"
      );
    }
    yield* validateReservationInterval(input, "createReservation");
  });

const pageOf = (
  selected: readonly DotyposReservation[],
  page: number
): ReservationPage => {
  const start = (page - 1) * dotyposMaximumPageSize;
  const end = start + dotyposMaximumPageSize;
  return {
    reservations: selected.slice(start, end),
    nextPage: end < selected.length ? Option.some(page + 1) : Option.none(),
  };
};

const parseInstant = (value: string | undefined) =>
  value === undefined ? undefined : Date.parse(value);
