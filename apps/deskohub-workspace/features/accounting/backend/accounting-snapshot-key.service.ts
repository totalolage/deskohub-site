import "server-only";

import { Context, Data, Effect, Layer, Schema } from "effect";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";
import {
  type AccountingSnapshotKeyId,
  accountingSnapshotKeyIdSchema,
} from "@/features/accounting/accounting-document-snapshot";

export class AccountingSnapshotKeyError extends Data.TaggedError(
  "AccountingSnapshotKeyError"
)<{
  readonly keyId: string;
  readonly message: string;
}> {}

export interface AccountingSnapshotKey {
  readonly id: AccountingSnapshotKeyId;
  readonly secret: string;
}

const decodeAccountingSnapshotKeyId = Schema.decodeUnknownEffect(
  accountingSnapshotKeyIdSchema
);

const getAccountingSnapshotKey = Effect.fn(
  "AccountingSnapshotKeyService.getAccountingSnapshotKey"
)(function* (keyId: string) {
  const decodedKeyId = yield* decodeAccountingSnapshotKeyId(keyId).pipe(
    Effect.mapError(
      () =>
        new AccountingSnapshotKeyError({
          keyId,
          message: "Accounting snapshot key ID is invalid.",
        })
    )
  );

  const secret = getAccountingDocumentSnapshotSecret(decodedKeyId);
  if (!secret) {
    return yield* new AccountingSnapshotKeyError({
      keyId: decodedKeyId,
      message: "Accounting snapshot key is unavailable or invalid.",
    });
  }

  return { id: decodedKeyId, secret } satisfies AccountingSnapshotKey;
});

export interface IAccountingSnapshotKeyService {
  readonly getActive: Effect.Effect<
    AccountingSnapshotKey,
    AccountingSnapshotKeyError
  >;
  readonly getById: (
    keyId: AccountingSnapshotKeyId
  ) => Effect.Effect<AccountingSnapshotKey, AccountingSnapshotKeyError>;
}

export class AccountingSnapshotKeyService extends Context.Service<
  AccountingSnapshotKeyService,
  IAccountingSnapshotKeyService
>()("@deskohub-workspace/accounting/AccountingSnapshotKeyService") {
  static Live = Layer.succeed(this, {
    getActive: getAccountingSnapshotKey(
      env.ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID
    ),
    getById: getAccountingSnapshotKey,
  });
}
