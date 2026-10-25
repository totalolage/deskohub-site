import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import type { Customer } from "@deskohub/dotypos/generated";
import { Context, Effect, Layer, Option } from "effect";
import type { DatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import {
  getDotyposLayer,
  waitForCancelledDotyposReservations,
} from "../integrations/dotypos";
import { pollUntil } from "../polling";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import { findAuthUserEmailById, removeSyntheticAuthUser } from "./auth-rows";
import {
  cancelSyntheticReservation,
  expireSyntheticCustomerProfile,
  readSyntheticCustomerProfile,
  requireSyntheticCustomerProfile,
} from "./fixtures";
import {
  readWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournalOwnerId,
  writeWorkspaceE2EAccountJournal,
} from "./journal";
import { removeWorkspaceE2EReferralRows } from "./referral-fixture";

/**
 * The synthetic account resources an account identity journal records: the
 * journal itself, the owners journal validation reads, and the provider and
 * database steps reconciliation runs to settle them.
 */
interface IWorkspaceE2EAccountResourceService {
  /** The owner's journal; undefined when its owner never admitted a case. */
  readonly readJournal: (
    ownerId: WorkspaceE2EAccountJournalOwnerId,
    directory?: string
  ) => Effect.Effect<WorkspaceE2EAccountJournal | undefined, WorkspaceE2EError>;
  readonly writeJournal: (
    journal: WorkspaceE2EAccountJournal,
    directory?: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  readonly readAuthUserEmail: (
    accountId: string
  ) => Effect.Effect<string | null | undefined, WorkspaceE2EError>;
  /** The profile; none when Dotypos has no customer with the id. */
  readonly readCustomerProfile: (
    customerId: string
  ) => Effect.Effect<Option.Option<Customer>, WorkspaceE2EError>;
  /** The owner's email; none when Dotypos has no reservation with the id. */
  readonly readReservationOwner: (
    reservationId: string
  ) => Effect.Effect<Option.Option<string | null>, WorkspaceE2EError>;
  /** Cancels the reservations and waits until Dotypos reports them cancelled. */
  readonly cancelReservations: (
    reservationIds: readonly string[]
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Expires (never deletes) the profile and waits until Dotypos reports it. */
  readonly expireProfile: (
    customerId: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
  /** Deletes the referral and reservation rows that name the resources. */
  readonly removeRows: (input: {
    readonly syntheticDotyposCustomerIds: readonly string[];
    readonly syntheticDotyposReservationIds: readonly string[];
  }) => Effect.Effect<void, WorkspaceE2EError>;
  /** Deletes the account as account deletion does, keeping its tombstone. */
  readonly removeAuthUser: (
    accountId: string
  ) => Effect.Effect<void, WorkspaceE2EError>;
}

export class WorkspaceE2EAccountResourceService extends Context.Service<
  WorkspaceE2EAccountResourceService,
  IWorkspaceE2EAccountResourceService
>()("WorkspaceE2EAccountResourceService") {
  static layer = (datasourceConfig: DatasourceConfig) =>
    Layer.effect(
      this,
      Effect.gen(function* () {
        const database = yield* E2EDatabase;
        const withDatabase = Effect.provideService(E2EDatabase, database);
        return WorkspaceE2EAccountResourceService.of({
          cancelReservations: Effect.fn(
            "WorkspaceE2EAccountResourceService.cancelReservations"
          )((reservationIds: readonly string[]) =>
            cancelAndConvergeReservations(datasourceConfig, reservationIds)
          ),
          expireProfile: Effect.fn(
            "WorkspaceE2EAccountResourceService.expireProfile"
          )((customerId: string) =>
            expireAndConvergeProfile(datasourceConfig, customerId)
          ),
          readAuthUserEmail: Effect.fn(
            "WorkspaceE2EAccountResourceService.readAuthUserEmail"
          )((accountId: string) =>
            findAuthUserEmailById(accountId).pipe(withDatabase)
          ),
          readCustomerProfile: Effect.fn(
            "WorkspaceE2EAccountResourceService.readCustomerProfile"
          )((customerId: string) =>
            readSyntheticCustomerProfile(
              datasourceConfig,
              customerId as DotyposCustomerId
            )
          ),
          readJournal: Effect.fn(
            "WorkspaceE2EAccountResourceService.readJournal"
          )((ownerId: WorkspaceE2EAccountJournalOwnerId, directory?: string) =>
            Effect.tryPromise({
              catch: (cause) =>
                workspaceE2EError("read workspace account e2e lane journal", {
                  cause,
                  operation: "read workspace account e2e lane journal",
                }),
              try: () => readWorkspaceE2EAccountJournal(ownerId, directory),
            })
          ),
          readReservationOwner: Effect.fn(
            "WorkspaceE2EAccountResourceService.readReservationOwner"
          )((reservationId: string) =>
            readReservationOwnerEmail(datasourceConfig, reservationId)
          ),
          removeAuthUser: Effect.fn(
            "WorkspaceE2EAccountResourceService.removeAuthUser"
          )((accountId: string) =>
            removeSyntheticAuthUser(accountId).pipe(withDatabase)
          ),
          removeRows: Effect.fn(
            "WorkspaceE2EAccountResourceService.removeRows"
          )(
            (input: {
              readonly syntheticDotyposCustomerIds: readonly string[];
              readonly syntheticDotyposReservationIds: readonly string[];
            }) =>
              removeWorkspaceE2EReferralRows({
                syntheticDotyposCustomerIds:
                  input.syntheticDotyposCustomerIds as DotyposCustomerId[],
                syntheticDotyposReservationIds:
                  input.syntheticDotyposReservationIds as DotyposReservationId[],
              }).pipe(withDatabase)
          ),
          writeJournal: Effect.fn(
            "WorkspaceE2EAccountResourceService.writeJournal"
          )((journal: WorkspaceE2EAccountJournal, directory?: string) =>
            Effect.tryPromise({
              catch: (cause) =>
                workspaceE2EError("persist workspace account e2e journal", {
                  cause,
                  operation: "persist workspace account e2e journal",
                }),
              try: () => writeWorkspaceE2EAccountJournal(journal, directory),
            })
          ),
        });
      })
    );
}

const readReservationOwnerEmail = (
  datasourceConfig: DatasourceConfig,
  reservationId: string
): Effect.Effect<Option.Option<string | null>, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const details = yield* dotypos.getReservation(
      reservationId as DotyposReservationId
    );
    return Option.map(details, ({ customer }) => customer.email ?? null);
  }).pipe(
    Effect.provide(getDotyposLayer(datasourceConfig)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("read synthetic account reservation owner", cause)
    )
  );

const cancelAndConvergeReservations = (
  datasourceConfig: DatasourceConfig,
  reservationIds: readonly string[]
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    if (reservationIds.length === 0) return;
    const dotyposReservationIds = reservationIds.map(
      (value) => value as DotyposReservationId
    );
    yield* Effect.forEach(
      dotyposReservationIds,
      (reservationId) =>
        cancelSyntheticReservation(datasourceConfig, reservationId),
      { concurrency: "unbounded", discard: true }
    );
    yield* waitForCancelledDotyposReservations(
      datasourceConfig,
      dotyposReservationIds,
      {
        endDate: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      }
    ).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError("converge synthetic account reservations", {
          cause,
          operation: "converge synthetic account reservations",
        })
      )
    );
  });

const expireAndConvergeProfile = (
  datasourceConfig: DatasourceConfig,
  customerId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* expireSyntheticCustomerProfile(
      datasourceConfig,
      customerId as DotyposCustomerId
    );
    yield* pollUntil(
      requireSyntheticCustomerProfile(
        datasourceConfig,
        customerId as DotyposCustomerId
      ).pipe(
        Effect.map((customer) =>
          customer.expireDate != null &&
          new Date(customer.expireDate).getTime() <= Date.now()
            ? customer
            : undefined
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        label: "expired synthetic Dotypos profile convergence",
        timeoutMs: datasourceConfig.timeouts.datasource,
      }
    );
  }).pipe(
    Effect.mapError((cause) =>
      workspaceE2EError("expire synthetic Dotypos profile", {
        cause,
        operation: "expire synthetic Dotypos profile",
      })
    )
  );
