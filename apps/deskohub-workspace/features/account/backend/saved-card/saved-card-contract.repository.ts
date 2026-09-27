import type {
  NexiContractId,
  NexiCustomerId,
  NexiOrderId,
} from "@deskohub/nexi";
import { and, asc, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CustomerCardContractRow,
  type CustomerCardEnrollmentRow,
  type CustomerCardEnrollmentState,
  customerCardContracts,
  customerCardEnrollments,
} from "@/db/schema";
import type { CustomerAccountId } from "../../customer-account";
import type { CustomerAccountLinkError } from "../customer-account-link.repository";

export type SavedCardContractRepositoryError = CustomerAccountLinkError;

export interface NewSavedCardEnrollment {
  readonly customerAccountId: CustomerAccountId;
  readonly orderId: NexiOrderId;
  readonly providerCustomerId: NexiCustomerId;
  readonly providerContractId: NexiContractId;
  readonly securityTokenDigest: string;
}

export interface SavedCardContractDisplayUpdate {
  readonly customerAccountId: CustomerAccountId;
  readonly providerContractId: NexiContractId;
  readonly displayCircuit?: string;
  readonly displaySuffix?: string;
}

interface ISavedCardContractRepository {
  readonly findPendingEnrollment: (
    customerAccountId: CustomerAccountId
  ) => Effect.Effect<
    CustomerCardEnrollmentRow | null,
    SavedCardContractRepositoryError
  >;
  readonly findEnrollmentByOrderId: (
    orderId: NexiOrderId
  ) => Effect.Effect<
    CustomerCardEnrollmentRow | null,
    SavedCardContractRepositoryError
  >;
  readonly listEnrollments: (
    customerAccountId: CustomerAccountId
  ) => Effect.Effect<
    readonly CustomerCardEnrollmentRow[],
    SavedCardContractRepositoryError
  >;
  readonly createEnrollment: (
    input: NewSavedCardEnrollment
  ) => Effect.Effect<
    CustomerCardEnrollmentRow,
    SavedCardContractRepositoryError
  >;
  readonly refreshEnrollmentSecurityTokenDigest: (input: {
    readonly orderId: NexiOrderId;
    readonly customerAccountId: CustomerAccountId;
    readonly securityTokenDigest: string;
  }) => Effect.Effect<void, SavedCardContractRepositoryError>;
  readonly transitionEnrollment: (input: {
    readonly orderId: NexiOrderId;
    readonly customerAccountId: CustomerAccountId;
    readonly state: CustomerCardEnrollmentState;
    readonly failureCode?: string;
  }) => Effect.Effect<
    CustomerCardEnrollmentRow | null,
    SavedCardContractRepositoryError
  >;
  readonly confirmEnrollmentFromAnyState: (input: {
    readonly orderId: NexiOrderId;
    readonly customerAccountId: CustomerAccountId;
  }) => Effect.Effect<
    CustomerCardEnrollmentRow | null,
    SavedCardContractRepositoryError
  >;
  /**
   * Bumps `updatedAt` for a reconciliation attempt so bounded, oldest-first
   * listing sweeps rotate through the unresolved set without starving rows.
   */
  readonly touchEnrollment: (input: {
    readonly orderId: NexiOrderId;
    readonly customerAccountId: CustomerAccountId;
  }) => Effect.Effect<void, SavedCardContractRepositoryError>;
  readonly listActiveContracts: (
    customerAccountId: CustomerAccountId
  ) => Effect.Effect<
    readonly CustomerCardContractRow[],
    SavedCardContractRepositoryError
  >;
  readonly findContract: (input: {
    readonly customerAccountId: CustomerAccountId;
    readonly providerContractId: NexiContractId;
  }) => Effect.Effect<
    CustomerCardContractRow | null,
    SavedCardContractRepositoryError
  >;
  readonly upsertActiveContract: (
    input: SavedCardContractDisplayUpdate & {
      readonly providerCustomerId: NexiCustomerId;
    }
  ) => Effect.Effect<void, SavedCardContractRepositoryError>;
  readonly markContractRemoved: (input: {
    readonly customerAccountId: CustomerAccountId;
    readonly providerContractId: NexiContractId;
  }) => Effect.Effect<void, SavedCardContractRepositoryError>;
}

/**
 * Ownership-scoped persistence for saved-card contracts and enrollments.
 * Every read and mutation carries the account id, so one account can never
 * observe or mutate another account's rows; the single orderId lookup exists
 * only to resume a verification flow and its subsequent mutations still
 * re-check the account id. State transitions are idempotent: enrollments
 * only leave `pending` once, and contracts only move `active` → `removed`.
 */
export class SavedCardContractRepository extends Context.Service<
  SavedCardContractRepository,
  ISavedCardContractRepository
>()("@deskohub-workspace/account/SavedCardContractRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const findPendingEnrollment = Effect.fn(
        "SavedCardContractRepository.findPendingEnrollment"
      )(function* (customerAccountId: CustomerAccountId) {
        const [row] = yield* db
          .select()
          .from(customerCardEnrollments)
          .where(
            and(
              eq(customerCardEnrollments.customerAccountId, customerAccountId),
              eq(customerCardEnrollments.state, "pending")
            )
          )
          .limit(1);
        return row ?? null;
      });

      const findEnrollmentByOrderId = Effect.fn(
        "SavedCardContractRepository.findEnrollmentByOrderId"
      )(function* (orderId: NexiOrderId) {
        const [row] = yield* db
          .select()
          .from(customerCardEnrollments)
          .where(eq(customerCardEnrollments.orderId, orderId))
          .limit(1);
        return row ?? null;
      });

      /**
       * Deterministic reconciliation selection order: oldest attempt first,
       * provider contract id as the tie-breaker, so a bounded sweep rotates
       * predictably instead of starving rows with equal timestamps.
       */
      const listEnrollments = Effect.fn(
        "SavedCardContractRepository.listEnrollments"
      )(function* (customerAccountId: CustomerAccountId) {
        return yield* db
          .select()
          .from(customerCardEnrollments)
          .where(
            eq(customerCardEnrollments.customerAccountId, customerAccountId)
          )
          .orderBy(
            asc(customerCardEnrollments.updatedAt),
            asc(customerCardEnrollments.providerContractId)
          );
      });

      const createEnrollment = Effect.fn(
        "SavedCardContractRepository.createEnrollment"
      )(function* (input: NewSavedCardEnrollment) {
        const [row] = yield* db
          .insert(customerCardEnrollments)
          .values({
            customerAccountId: input.customerAccountId,
            orderId: input.orderId,
            providerCustomerId: input.providerCustomerId,
            providerContractId: input.providerContractId,
            securityTokenDigest: input.securityTokenDigest,
            state: "pending",
          })
          .returning();
        if (!row) {
          return yield* Effect.die(
            new Error("Enrollment insert returned no row.")
          );
        }
        return row;
      });

      const refreshEnrollmentSecurityTokenDigest = Effect.fn(
        "SavedCardContractRepository.refreshEnrollmentSecurityTokenDigest"
      )(function* (input: {
        orderId: NexiOrderId;
        customerAccountId: CustomerAccountId;
        securityTokenDigest: string;
      }) {
        yield* db
          .update(customerCardEnrollments)
          .set({
            securityTokenDigest: input.securityTokenDigest,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(customerCardEnrollments.orderId, input.orderId),
              eq(
                customerCardEnrollments.customerAccountId,
                input.customerAccountId
              ),
              eq(customerCardEnrollments.state, "pending")
            )
          )
          .pipe(Effect.asVoid);
      });

      const transitionEnrollment = Effect.fn(
        "SavedCardContractRepository.transitionEnrollment"
      )(function* (input: {
        orderId: NexiOrderId;
        customerAccountId: CustomerAccountId;
        state: CustomerCardEnrollmentState;
        failureCode?: string;
      }) {
        const [row] = yield* db
          .update(customerCardEnrollments)
          .set({
            state: input.state,
            failureCode: input.failureCode,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(customerCardEnrollments.orderId, input.orderId),
              eq(
                customerCardEnrollments.customerAccountId,
                input.customerAccountId
              ),
              eq(customerCardEnrollments.state, "pending")
            )
          )
          .returning();
        return row ?? null;
      });

      /**
       * Late-success reconciliation move: a provider-confirmed enrollment is
       * marked confirmed regardless of its current local state, so cancelled,
       * failed, or superseded rows recover when the provider shows the
       * verification actually succeeded.
       */
      const confirmEnrollmentFromAnyState = Effect.fn(
        "SavedCardContractRepository.confirmEnrollmentFromAnyState"
      )(function* (input: {
        orderId: NexiOrderId;
        customerAccountId: CustomerAccountId;
      }) {
        const [row] = yield* db
          .update(customerCardEnrollments)
          .set({
            state: "confirmed",
            failureCode: null,
            updatedAt: Temporal.Now.instant(),
          })
          .where(
            and(
              eq(customerCardEnrollments.orderId, input.orderId),
              eq(
                customerCardEnrollments.customerAccountId,
                input.customerAccountId
              )
            )
          )
          .returning();
        return row ?? null;
      });

      const touchEnrollment = Effect.fn(
        "SavedCardContractRepository.touchEnrollment"
      )(function* (input: {
        orderId: NexiOrderId;
        customerAccountId: CustomerAccountId;
      }) {
        yield* db
          .update(customerCardEnrollments)
          .set({ updatedAt: Temporal.Now.instant() })
          .where(
            and(
              eq(customerCardEnrollments.orderId, input.orderId),
              eq(
                customerCardEnrollments.customerAccountId,
                input.customerAccountId
              )
            )
          )
          .pipe(Effect.asVoid);
      });

      const listActiveContracts = Effect.fn(
        "SavedCardContractRepository.listActiveContracts"
      )(function* (customerAccountId: CustomerAccountId) {
        return yield* db
          .select()
          .from(customerCardContracts)
          .where(
            and(
              eq(customerCardContracts.customerAccountId, customerAccountId),
              eq(customerCardContracts.state, "active")
            )
          );
      });

      const findContract = Effect.fn(
        "SavedCardContractRepository.findContract"
      )(function* (input: {
        customerAccountId: CustomerAccountId;
        providerContractId: NexiContractId;
      }) {
        const [row] = yield* db
          .select()
          .from(customerCardContracts)
          .where(
            and(
              eq(
                customerCardContracts.customerAccountId,
                input.customerAccountId
              ),
              eq(
                customerCardContracts.providerContractId,
                input.providerContractId
              )
            )
          )
          .limit(1);
        return row ?? null;
      });

      const upsertActiveContract = Effect.fn(
        "SavedCardContractRepository.upsertActiveContract"
      )(function* (
        input: SavedCardContractDisplayUpdate & {
          providerCustomerId: NexiCustomerId;
        }
      ) {
        yield* db
          .insert(customerCardContracts)
          .values({
            customerAccountId: input.customerAccountId,
            providerCustomerId: input.providerCustomerId,
            providerContractId: input.providerContractId,
            state: "active",
            displayCircuit: input.displayCircuit ?? null,
            displaySuffix: input.displaySuffix ?? null,
          })
          .onConflictDoUpdate({
            target: customerCardContracts.providerContractId,
            set: {
              state: "active",
              displayCircuit: input.displayCircuit ?? null,
              displaySuffix: input.displaySuffix ?? null,
              updatedAt: Temporal.Now.instant(),
            },
            setWhere: eq(
              customerCardContracts.customerAccountId,
              input.customerAccountId
            ),
          })
          .pipe(Effect.asVoid);
      });

      const markContractRemoved = Effect.fn(
        "SavedCardContractRepository.markContractRemoved"
      )(function* (input: {
        customerAccountId: CustomerAccountId;
        providerContractId: NexiContractId;
      }) {
        yield* db
          .update(customerCardContracts)
          .set({ state: "removed", updatedAt: Temporal.Now.instant() })
          .where(
            and(
              eq(
                customerCardContracts.customerAccountId,
                input.customerAccountId
              ),
              eq(
                customerCardContracts.providerContractId,
                input.providerContractId
              ),
              eq(customerCardContracts.state, "active")
            )
          )
          .pipe(Effect.asVoid);
      });

      return {
        findPendingEnrollment,
        findEnrollmentByOrderId,
        listEnrollments,
        createEnrollment,
        refreshEnrollmentSecurityTokenDigest,
        transitionEnrollment,
        confirmEnrollmentFromAnyState,
        touchEnrollment,
        listActiveContracts,
        findContract,
        upsertActiveContract,
        markContractRemoved,
      } satisfies ISavedCardContractRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
