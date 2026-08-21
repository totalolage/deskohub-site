import type { NexiOrderId } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { accountingDocumentSnapshots } from "@/db/schema";
import {
  type AccountingDocumentSnapshot,
  decodeStoredAccountingDocumentSnapshot,
  getAccountingDocumentOrderId,
} from "@/features/accounting/accounting-document-snapshot";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import type { OrderId } from "@/features/order";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { decryptAccountingSnapshot } from "./accounting-snapshot-sql";

export type AccountingPaymentReference =
  | { readonly type: "paymentAttemptId"; readonly id: PaymentAttemptId }
  | { readonly type: "providerOrderId"; readonly id: NexiOrderId }
  | { readonly type: "orderId"; readonly id: OrderId }
  | {
      readonly type: "workspaceReservationId";
      readonly id: WorkspaceReservationId;
    };

export class AccountingDocumentSnapshotStorageError extends Data.TaggedError(
  "AccountingDocumentSnapshotStorageError"
)<{
  readonly operation: "decrypt" | "encrypt" | "load" | "parse" | "validate";
  readonly paymentReference: AccountingPaymentReference;
  readonly message: string;
}> {}

export interface IAccountingDocumentSnapshotRepository {
  readonly findByPaymentAttemptId: (
    paymentAttemptId: PaymentAttemptId
  ) => Effect.Effect<
    AccountingDocumentSnapshot | null,
    AccountingDocumentSnapshotStorageError | EffectDrizzleQueryError
  >;
}

export class AccountingDocumentSnapshotRepository extends Context.Service<
  AccountingDocumentSnapshotRepository,
  IAccountingDocumentSnapshotRepository
>()("@deskohub-workspace/accounting/AccountingDocumentSnapshotRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const keys = yield* AccountingSnapshotKeyService;

      return {
        findByPaymentAttemptId: Effect.fn(
          "AccountingDocumentSnapshotRepository.findByPaymentAttemptId"
        )(function* (paymentAttemptId: PaymentAttemptId) {
          const [metadata] = yield* db
            .select({
              keyId: accountingDocumentSnapshots.keyId,
              orderId: accountingDocumentSnapshots.orderId,
              workspaceReservationId:
                accountingDocumentSnapshots.workspaceReservationId,
            })
            .from(accountingDocumentSnapshots)
            .where(
              eq(accountingDocumentSnapshots.paymentAttemptId, paymentAttemptId)
            )
            .limit(1);

          if (!metadata) return null;

          const key = yield* keys.getById(metadata.keyId).pipe(
            Effect.mapError(
              () =>
                new AccountingDocumentSnapshotStorageError({
                  operation: "decrypt",
                  paymentReference: {
                    type: "paymentAttemptId",
                    id: paymentAttemptId,
                  },
                  message: "Accounting snapshot decryption key is unavailable.",
                })
            )
          );

          const [row] = yield* db
            .select({
              snapshotJson: decryptAccountingSnapshot(
                accountingDocumentSnapshots.encryptedSnapshot,
                key.secret
              ),
            })
            .from(accountingDocumentSnapshots)
            .where(
              eq(accountingDocumentSnapshots.paymentAttemptId, paymentAttemptId)
            )
            .limit(1)
            .pipe(
              Effect.withTracerEnabled(false),
              Effect.mapError(
                () =>
                  new AccountingDocumentSnapshotStorageError({
                    operation: "decrypt",
                    paymentReference: {
                      type: "paymentAttemptId",
                      id: paymentAttemptId,
                    },
                    message: "Accounting snapshot could not be decrypted.",
                  })
              )
            );

          if (!row) {
            return yield* new AccountingDocumentSnapshotStorageError({
              operation: "load",
              paymentReference: {
                type: "paymentAttemptId",
                id: paymentAttemptId,
              },
              message: "Accounting snapshot disappeared while loading.",
            });
          }

          const encoded = yield* Effect.try({
            try: () => JSON.parse(row.snapshotJson) as unknown,
            catch: () =>
              new AccountingDocumentSnapshotStorageError({
                operation: "parse",
                paymentReference: {
                  type: "paymentAttemptId",
                  id: paymentAttemptId,
                },
                message: "Accounting snapshot JSON is invalid.",
              }),
          });

          const snapshot = yield* decodeStoredAccountingDocumentSnapshot(
            encoded
          ).pipe(
            Effect.mapError(
              () =>
                new AccountingDocumentSnapshotStorageError({
                  operation: "parse",
                  paymentReference: {
                    type: "paymentAttemptId",
                    id: paymentAttemptId,
                  },
                  message: "Accounting snapshot schema is invalid.",
                })
            )
          );

          if (
            getAccountingDocumentOrderId(snapshot) !==
            (metadata.orderId ?? metadata.workspaceReservationId)
          ) {
            return yield* new AccountingDocumentSnapshotStorageError({
              operation: "validate",
              paymentReference: {
                type: "paymentAttemptId",
                id: paymentAttemptId,
              },
              message:
                "Accounting snapshot metadata does not match its encrypted document.",
            });
          }

          return snapshot;
        }),
      } satisfies IAccountingDocumentSnapshotRepository;
    })
  );
}
