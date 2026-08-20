import "server-only";

import { Effect, Layer, Schema } from "effect";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import {
  type AccountingSnapshotKey,
  AccountingSnapshotKeyError,
  AccountingSnapshotKeyService,
} from "./accounting-snapshot-key.service";

export const makeAccountingSnapshotKeyLayer = () =>
  Layer.succeed(AccountingSnapshotKeyService, {
    getActive: getAccountingSnapshotKey(
      env.ACCOUNTING_DOCUMENT_SNAPSHOT_ACTIVE_KEY_ID
    ),
    getById: getAccountingSnapshotKey,
  });

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
