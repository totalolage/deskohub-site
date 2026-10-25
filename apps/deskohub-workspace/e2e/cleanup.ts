import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Cause, Effect, Exit, Option } from "effect";
import { splitCustomerName } from "@/features/checkout/backend/reservation/dotypos-customer-policy";
import { getWorkspaceE2EDateInterval } from "./capacity";
import type { DatasourceConfig } from "./config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "./errors";
import {
  readCheckoutRow,
  readCleanupCheckoutRows,
} from "./integrations/database";
import type { E2EDatabase } from "./integrations/database.service";
import {
  cancelDotyposReservation,
  getDotyposLayer,
  waitForCancelledDotyposReservations,
} from "./integrations/dotypos";
import { log, redact } from "./runtime";
import type { CheckoutData, CheckoutFlowState, CheckoutRow } from "./types";

export const cleanupCheckoutFlowStates = (
  {
    datasourceConfig,
    flowStates,
    workflowError,
  }: {
    datasourceConfig: DatasourceConfig | undefined;
    flowStates: readonly CheckoutFlowState[];
    workflowError: unknown;
  },
  dependencies: CleanupDependencies = liveCleanupDependencies
): Effect.Effect<WorkspaceE2EError | undefined, never, E2EDatabase> =>
  Effect.gen(function* () {
    const preparedExit = yield* Effect.exit(
      prepareCheckoutFlowCleanup({ datasourceConfig, flowStates }, dependencies)
    );
    if (Exit.isFailure(preparedExit)) {
      return toWorkspaceE2EError(
        "prepare checkout cleanup candidates",
        Cause.squash(preparedExit.cause)
      );
    }
    return yield* cleanupPreparedCheckoutFlowStates(
      { datasourceConfig, prepared: preparedExit.value, workflowError },
      dependencies
    );
  });

export type PreparedCheckoutFlowCleanup = {
  readonly checkoutRows: readonly CheckoutRow[];
  readonly completedReservationIds: ReadonlySet<DotyposReservationId>;
  readonly flowStates: readonly CheckoutFlowState[];
};

type CheckoutReservationOwner = {
  readonly customerId: DotyposCustomerId | undefined;
  readonly email: string | null | undefined;
};

type CheckoutCleanupCandidate = {
  readonly expectedEmails: readonly string[];
  readonly row: CheckoutRow;
};

export const prepareCheckoutFlowCleanup = (
  {
    datasourceConfig,
    flowStates,
  }: {
    readonly datasourceConfig: DatasourceConfig | undefined;
    readonly flowStates: readonly CheckoutFlowState[];
  },
  dependencies: CleanupDependencies = liveCleanupDependencies
): Effect.Effect<PreparedCheckoutFlowCleanup, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const completedReservationIds = new Set(
      flowStates.flatMap((state) => {
        const reservationId =
          state.completedDotyposReservationId ??
          state.checkoutRow?.dotypos_reservation_id;
        return state.cleanupComplete && reservationId ? [reservationId] : [];
      })
    );
    const candidates: CheckoutCleanupCandidate[] = [];
    const checkoutRows: CheckoutRow[] = [];

    for (const state of flowStates) {
      if (state.checkoutRow) {
        checkoutRows.push(state.checkoutRow);
        if (
          state.checkoutRow.dotypos_reservation_id &&
          !completedReservationIds.has(state.checkoutRow.dotypos_reservation_id)
        ) {
          candidates.push({
            expectedEmails: [state.data.email],
            row: state.checkoutRow,
          });
        }
      }
    }

    if (datasourceConfig) {
      const fallbackQueries = getFallbackCleanupQueries(flowStates);
      const lookupResults = yield* Effect.all(
        {
          // Fallback rows are scoped to the Dotypos customers this run's
          // unique contacts own, so concurrent runs' rows never become
          // candidates; the owner check below stays as a backstop.
          fallbackRows: Effect.all(
            fallbackQueries.map((query) =>
              dependencies
                .readCleanupCustomerIds(
                  datasourceConfig,
                  query.states.map(({ data }) => data)
                )
                .pipe(
                  Effect.flatMap((customerIds) =>
                    dependencies.readCleanupCheckoutRows(
                      query.startedAt,
                      query.data,
                      customerIds
                    )
                  ),
                  Effect.map((rows) => ({ query, rows }))
                )
            ),
            { concurrency: "unbounded" }
          ),
          rowsByOrder: Effect.all(
            flowStates.flatMap((state) =>
              !state.checkoutRow?.dotypos_reservation_id && state.orderId
                ? [
                    dependencies
                      .readCheckoutRow(state.orderId)
                      .pipe(Effect.map((row) => ({ row, state }))),
                  ]
                : []
            ),
            { concurrency: "unbounded" }
          ),
        },
        { concurrency: "unbounded" }
      );

      for (const { row, state } of lookupResults.rowsByOrder) {
        state.checkoutRow = row;
        if (!row) continue;
        checkoutRows.push(row);
        if (!row.dotypos_reservation_id) continue;
        if (row.reservation_id !== state.orderId) {
          return yield* workspaceE2EError(
            "Workspace checkout cleanup order ownership mismatch",
            { operation: "validate checkout cleanup order ownership" }
          );
        }
        if (!completedReservationIds.has(row.dotypos_reservation_id)) {
          candidates.push({ expectedEmails: [state.data.email], row });
        }
      }

      for (const { query, rows } of lookupResults.fallbackRows) {
        for (const row of rows) {
          checkoutRows.push(row);
          if (!row.dotypos_reservation_id) continue;
          if (!completedReservationIds.has(row.dotypos_reservation_id)) {
            candidates.push({
              expectedEmails: query.states.map(({ data }) => data.email),
              row,
            });
          }
        }
      }
    }

    if (datasourceConfig) {
      const reservationIds = [
        ...new Set(
          candidates.flatMap(({ row }) =>
            row.dotypos_reservation_id ? [row.dotypos_reservation_id] : []
          )
        ),
      ];
      const ownerResults = yield* Effect.all(
        reservationIds.map((reservationId) =>
          dependencies
            .readDotyposReservationOwner(datasourceConfig, reservationId)
            .pipe(
              Effect.map(
                (owner) =>
                  [reservationId, Option.getOrUndefined(owner)] as const
              )
            )
        ),
        { concurrency: "unbounded" }
      );
      const owners = new Map(ownerResults);

      for (const { expectedEmails, row } of candidates) {
        const reservationId = row.dotypos_reservation_id;
        if (!reservationId || completedReservationIds.has(reservationId)) {
          continue;
        }
        const owner = owners.get(reservationId);
        if (owner === undefined) {
          completedReservationIds.add(reservationId);
          continue;
        }
        if (!row.dotypos_customer_id || !owner.customerId) {
          return yield* workspaceE2EError(
            "Workspace checkout cleanup reservation owner is unavailable",
            { operation: "validate checkout cleanup reservation owner" }
          );
        }
        if (row.dotypos_customer_id !== owner.customerId) {
          return yield* workspaceE2EError(
            "Workspace checkout cleanup reservation owner mismatch",
            { operation: "validate checkout cleanup reservation owner" }
          );
        }
        if (owner.email == null) {
          return yield* workspaceE2EError(
            "Workspace checkout cleanup reservation email is unavailable",
            { operation: "validate checkout cleanup reservation owner" }
          );
        }
        if (!expectedEmails.includes(owner.email)) {
          return yield* workspaceE2EError(
            "Workspace checkout cleanup recipient ownership mismatch",
            { operation: "validate checkout cleanup reservation owner" }
          );
        }
      }
    }

    return {
      checkoutRows: [
        ...new Map(
          checkoutRows
            .filter((row) => row.dotypos_reservation_id)
            .map((row) => [row.dotypos_reservation_id, row] as const)
        ).values(),
      ],
      completedReservationIds,
      flowStates,
    };
  });

export const cleanupPreparedCheckoutFlowStates = (
  {
    datasourceConfig,
    prepared,
    workflowError,
  }: {
    readonly datasourceConfig: DatasourceConfig | undefined;
    readonly prepared: PreparedCheckoutFlowCleanup;
    readonly workflowError: unknown;
  },
  dependencies: CleanupDependencies = liveCleanupDependencies
): Effect.Effect<WorkspaceE2EError | undefined, never, E2EDatabase> =>
  Effect.gen(function* () {
    if (!datasourceConfig) return undefined;
    const cleanupErrors: WorkspaceE2EError[] = [];
    const dotyposReservationIds = prepared.checkoutRows.flatMap((row) =>
      row.dotypos_reservation_id ? [row.dotypos_reservation_id] : []
    );
    const cleanupExits = yield* Effect.all(
      dotyposReservationIds
        .filter(
          (reservationId) =>
            !prepared.completedReservationIds.has(reservationId)
        )
        .map((dotyposReservationId) =>
          Effect.exit(
            dependencies.cancelDotyposReservation(
              datasourceConfig,
              dotyposReservationId
            )
          ).pipe(Effect.map((exit) => ({ dotyposReservationId, exit })))
        ),
      { concurrency: "unbounded" }
    );
    const convergingReservationIds = new Set(prepared.completedReservationIds);

    for (const { dotyposReservationId, exit: cleanupExit } of cleanupExits) {
      if (Exit.isSuccess(cleanupExit)) {
        convergingReservationIds.add(dotyposReservationId);
      } else {
        const cause = Cause.squash(cleanupExit.cause);
        cleanupErrors.push(
          toWorkspaceE2EError("cancel Dotypos checkout reservation", cause)
        );
        if (workflowError)
          log(`Dotypos cleanup failed: ${redact(String(cause))}`);
      }
    }

    if (
      convergingReservationIds.size > 0 &&
      dependencies.waitForCancelledDotyposReservations
    ) {
      const reservationDates = prepared.flowStates
        .map(({ data }) => data.date)
        .sort();
      const fromDate = reservationDates[0];
      const toDate = reservationDates.at(-1);
      const convergenceExit = yield* Effect.exit(
        fromDate && toDate
          ? dependencies.waitForCancelledDotyposReservations(
              datasourceConfig,
              [...convergingReservationIds],
              getWorkspaceE2EDateInterval({ fromDate, toDate })
            )
          : Effect.fail(
              workspaceE2EError(
                "Dotypos cleanup reservations have no owned dates",
                { operation: "wait for Dotypos cleanup convergence" }
              )
            )
      );
      if (Exit.isFailure(convergenceExit)) {
        const cause = Cause.squash(convergenceExit.cause);
        cleanupErrors.push(
          toWorkspaceE2EError("wait for Dotypos cleanup convergence", cause)
        );
        if (workflowError)
          log(`Dotypos cleanup convergence failed: ${redact(String(cause))}`);
      }
    }

    return toCleanupError(cleanupErrors);
  });

export const cleanupOwnedCheckoutFlowStates = (
  {
    datasourceConfig,
    flowStates,
    workflowError,
  }: {
    readonly datasourceConfig: DatasourceConfig;
    readonly flowStates: readonly CheckoutFlowState[];
    readonly workflowError: unknown;
  },
  dependencies: OwnedCleanupDependencies = liveCleanupDependencies
): Effect.Effect<WorkspaceE2EError | undefined, never, E2EDatabase> =>
  Effect.gen(function* () {
    const cleanupErrors: WorkspaceE2EError[] = [];
    const reservationOwners = new Map<
      DotyposReservationId,
      CheckoutFlowState[]
    >();
    const lookupResults = yield* Effect.all(
      flowStates.map((state) => {
        if (state.checkoutRow?.dotypos_reservation_id || !state.orderId) {
          return Effect.succeed({
            exit: Exit.succeed(state.checkoutRow),
            state,
          });
        }

        return Effect.exit(dependencies.readCheckoutRow(state.orderId)).pipe(
          Effect.map((exit) => ({ exit, state }))
        );
      }),
      { concurrency: "unbounded" }
    );

    for (const { exit: rowExit, state } of lookupResults) {
      if (Exit.isFailure(rowExit)) {
        const cause = Cause.squash(rowExit.cause);
        cleanupErrors.push(
          toWorkspaceE2EError("read case-owned checkout cleanup row", cause)
        );
        if (workflowError)
          log(
            `Case-owned Dotypos cleanup row lookup failed: ${redact(String(cause))}`
          );
        continue;
      }

      const row = rowExit.value;
      if (row) state.checkoutRow = row;
      const reservationId = row?.dotypos_reservation_id;
      if (reservationId) {
        const owners = reservationOwners.get(reservationId);
        if (owners) owners.push(state);
        else reservationOwners.set(reservationId, [state]);
      } else if (!state.startedAt) {
        state.cleanupComplete = true;
      }
    }

    const cancellationResults = yield* Effect.all(
      [...reservationOwners].map(([reservationId, owners]) =>
        Effect.exit(
          dependencies.cancelDotyposReservation(datasourceConfig, reservationId)
        ).pipe(Effect.map((exit) => ({ exit, owners, reservationId })))
      ),
      { concurrency: "unbounded" }
    );

    for (const {
      exit: cleanupExit,
      owners,
      reservationId,
    } of cancellationResults) {
      if (Exit.isSuccess(cleanupExit)) {
        for (const state of owners) {
          state.cleanupComplete = true;
          state.completedDotyposReservationId = reservationId;
        }
        continue;
      }

      const cause = Cause.squash(cleanupExit.cause);
      cleanupErrors.push(
        toWorkspaceE2EError("cancel case-owned Dotypos reservation", cause)
      );
      if (workflowError)
        log(`Case-owned Dotypos cleanup failed: ${redact(String(cause))}`);
    }

    return toCleanupError(cleanupErrors);
  });

interface CleanupDependencies {
  readonly cancelDotyposReservation: typeof cancelDotyposReservation;
  readonly readCheckoutRow: typeof readCheckoutRow;
  readonly readCleanupCheckoutRows: typeof readCleanupCheckoutRows;
  readonly readCleanupCustomerIds: (
    config: DatasourceConfig,
    contacts: readonly CheckoutData[]
  ) => Effect.Effect<readonly DotyposCustomerId[], WorkspaceE2EError>;
  readonly readDotyposReservationOwner: (
    config: DatasourceConfig,
    reservationId: DotyposReservationId
  ) => Effect.Effect<
    Option.Option<CheckoutReservationOwner>,
    WorkspaceE2EError
  >;
  readonly waitForCancelledDotyposReservations?: typeof waitForCancelledDotyposReservations;
}

type OwnedCleanupDependencies = Pick<
  CleanupDependencies,
  "cancelDotyposReservation" | "readCheckoutRow"
>;

const readCheckoutCleanupReservationOwner = Effect.fn(
  "readCheckoutCleanupReservationOwner"
)(function* (config: DatasourceConfig, reservationId: DotyposReservationId) {
  const details = yield* Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* dotypos.getReservation(reservationId);
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("read checkout cleanup reservation owner", cause)
    )
  );
  return Option.map(details, ({ customer }) => ({
    customerId: customer.id as DotyposCustomerId | undefined,
    email: customer.email,
  }));
});

// Each checkout contact's email is unique to its flow, so every Dotypos
// customer matching it belongs to this run.
export const readCheckoutCleanupCustomerIds = Effect.fn(
  "readCheckoutCleanupCustomerIds"
)(function* (config: DatasourceConfig, contacts: readonly CheckoutData[]) {
  const customers = yield* Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* Effect.forEach(
      contacts,
      (contact) =>
        dotypos
          .findCustomer(
            { ...splitCustomerName(contact.name), email: contact.email },
            { lookupFields: ["email"] }
          )
          .pipe(
            Effect.map((result) =>
              result._tag === "Matched"
                ? [result.customer, ...result.matches]
                : result.matches
            )
          ),
      { concurrency: "unbounded" }
    );
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("read checkout cleanup customers", cause)
    )
  );
  return [
    ...new Set(
      customers
        .flat()
        .flatMap(({ id }) => (id ? [id as DotyposCustomerId] : []))
    ),
  ];
});

const liveCleanupDependencies: CleanupDependencies = {
  cancelDotyposReservation,
  readCheckoutRow,
  readCleanupCheckoutRows,
  readCleanupCustomerIds: readCheckoutCleanupCustomerIds,
  readDotyposReservationOwner: readCheckoutCleanupReservationOwner,
  waitForCancelledDotyposReservations,
};

const getFallbackCleanupQueries = (
  flowStates: readonly CheckoutFlowState[]
): readonly {
  readonly data: CheckoutData;
  readonly startedAt: Date;
  readonly states: readonly CheckoutFlowState[];
}[] => {
  const queries = new Map<
    string,
    {
      readonly data: CheckoutData;
      startedAt: Date;
      states: CheckoutFlowState[];
    }
  >();

  for (const state of flowStates) {
    if (state.checkoutRow?.dotypos_reservation_id || !state.startedAt) continue;

    const key = JSON.stringify({
      locale: state.data.locale,
      reservationDetails: state.data.expectedReservationDetails,
    });
    const existing = queries.get(key);
    if (!existing) {
      queries.set(key, {
        data: state.data,
        startedAt: state.startedAt,
        states: [state],
      });
    } else {
      existing.states.push(state);
      if (state.startedAt < existing.startedAt) {
        existing.startedAt = state.startedAt;
      }
    }
  }

  return [...queries.values()];
};

const toCleanupError = (
  cleanupErrors: readonly WorkspaceE2EError[]
): WorkspaceE2EError | undefined => {
  if (cleanupErrors.length === 0) return undefined;
  if (cleanupErrors.length === 1) return cleanupErrors[0];
  return workspaceE2EError("Workspace e2e cleanup failed", {
    causes: cleanupErrors,
    operation: "workspace e2e cleanup",
  });
};
