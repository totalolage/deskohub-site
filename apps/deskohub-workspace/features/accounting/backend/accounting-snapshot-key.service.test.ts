import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";

const runKeys = <A, E>(
  operation: (
    keys: AccountingSnapshotKeyService["Service"]
  ) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    const keys = yield* AccountingSnapshotKeyService;
    return yield* operation(keys);
  }).pipe(
    Effect.provide(AccountingSnapshotKeyService.Default),
    Effect.runPromise
  );

describe("accounting snapshot keys", () => {
  test("rejects an unconfigured key ID", async () => {
    await expect(
      runKeys((keys) =>
        keys.getById(accountingSnapshotKeyIdSchema.make("K209912"))
      )
    ).rejects.toMatchObject({
      _tag: "AccountingSnapshotKeyError",
      keyId: "K209912",
    });
  });
});
