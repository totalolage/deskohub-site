import "server-only";

import { Context, Data, Effect, Layer } from "effect";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";

const snapshotKeyIdPattern = /^[A-Z][A-Z0-9_]{2,31}$/;
const snapshotSecretPattern = /^[A-Za-z0-9_-]{43}$/;

export class AccountingSnapshotKeyError extends Data.TaggedError(
  "AccountingSnapshotKeyError"
)<{
  readonly keyId: string;
  readonly message: string;
}> {}

export interface AccountingSnapshotKey {
  readonly id: string;
  readonly secret: string;
}

const getAccountingSnapshotKey = Effect.fn(
  "AccountingSnapshotKeyService.getAccountingSnapshotKey"
)(function* (keyId: string) {
  if (!snapshotKeyIdPattern.test(keyId)) {
    return yield* new AccountingSnapshotKeyError({
      keyId,
      message: "Accounting snapshot key ID is invalid.",
    });
  }

  const secret = getAccountingDocumentSnapshotSecret(keyId);
  if (
    !secret ||
    !snapshotSecretPattern.test(secret) ||
    Buffer.from(secret, "base64url").byteLength !== 32
  ) {
    return yield* new AccountingSnapshotKeyError({
      keyId,
      message: "Accounting snapshot key is unavailable or invalid.",
    });
  }

  return { id: keyId, secret };
});

export interface IAccountingSnapshotKeyService {
  readonly getActive: Effect.Effect<
    AccountingSnapshotKey,
    AccountingSnapshotKeyError
  >;
  readonly getById: (
    keyId: string
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
