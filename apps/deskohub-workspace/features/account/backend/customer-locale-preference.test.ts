import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer, Result } from "effect";
import { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type CustomerAccountSectionsFixture,
  makeCustomerAccountSections,
  sectionAccountId,
} from "./customer-account-sections.test-utils";
import { saveAccountLocalePreference } from "./customer-locale-preference";

const save = (
  fixture: CustomerAccountSectionsFixture,
  options: { readonly writeFails?: boolean } = {}
) => {
  const writes: string[] = [];
  const sections = makeCustomerAccountSections(fixture);
  const fakeDb = {
    update: () => ({
      set: (values: { locale: string }) => ({
        where: () =>
          options.writeFails
            ? Effect.fail(
                new SqlError.SqlError({
                  reason: new SqlError.ConnectionError({
                    cause: new Error("write failed"),
                    message: "write failed",
                    operation: "execute",
                  }),
                })
              )
            : Effect.sync(() => {
                sections.events.push("write");
                writes.push(values.locale);
              }),
      }),
    }),
  };
  const run = saveAccountLocalePreference(sectionAccountId, "en-US").pipe(
    Effect.result,
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.make(fakeDb as never)
        ),
        sections.layer
      )
    ),
    Effect.runPromise
  );
  return { run, writes, events: sections.events };
};

describe("saveAccountLocalePreference", () => {
  test("writes after rechecking the session under the account lock", async () => {
    const { run, writes, events } = save({ session: {} });

    expect(Result.isSuccess(await run)).toBe(true);
    expect(writes).toEqual(["en-US"]);
    expect(events).toEqual([
      "account-lock-acquired",
      "account-session",
      "account-activity",
      "write",
      "account-lock-released",
    ]);
  });

  test("never writes for a session gone by the time the lock is held", async () => {
    const { run, writes } = save({ session: null });

    const outcome = await run;
    expect(Result.isFailure(outcome) && outcome.failure.reason).toBe(
      "unauthenticated"
    );
    expect(writes).toEqual([]);
  });

  test("maps a lock failure to the account lock cause without writing", async () => {
    const { run, writes } = save({ session: {}, lockUnavailable: true });

    const outcome = await run;
    expect(Result.isFailure(outcome) && outcome.failure.cause?.code).toBe(
      "account-link.lock"
    );
    expect(writes).toEqual([]);
  });

  test("maps a failed write to the locale preference write cause", async () => {
    const { run } = save({ session: {} }, { writeFails: true });

    const outcome = await run;
    expect(Result.isFailure(outcome) && outcome.failure.cause?.code).toBe(
      "account-locale-preference.write"
    );
  });
});
