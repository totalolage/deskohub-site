import { Context, Data, Effect, Layer } from "effect";
import type { AccountingSnapshotKeyId } from "@/features/accounting/accounting-document-snapshot";

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
  static Live = Layer.unwrap(
    Effect.promise(async () => {
      const { makeAccountingSnapshotKeyLayer } = await import(
        "./accounting-snapshot-key-provider.server"
      );
      return makeAccountingSnapshotKeyLayer();
    })
  );
}
