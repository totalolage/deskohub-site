import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer, Result } from "effect";
import { SqlError } from "effect/unstable/sql";
import { WorkspaceDatabase } from "@/db/database.service";
import type { Locale } from "@/features/i18n";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
} from "../customer-account";
import {
  type CustomerAccountSectionsFixture,
  makeCustomerAccountSections,
  sectionAccountId,
} from "./customer-account-sections.test-utils";
import { saveAccountLocalePreference } from "./customer-locale-preference";
import { CustomerLocalePreference } from "./customer-locale-preference.service";

const save = (
  fixture: CustomerAccountSectionsFixture,
  options: {
    readonly writeFails?: boolean;
    /** Saves through this instead of `saveAccountLocalePreference` itself. */
    readonly through?: (
      accountId: CustomerAccountId,
      locale: Locale
    ) => Effect.Effect<
      void,
      CustomerAccountAccessError,
      CustomerLocalePreference
    >;
  } = {}
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
  const dependencies = Layer.mergeAll(
    Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(fakeDb as never)),
    sections.layer
  );
  const run = (
    options.through
      ? options
          .through(sectionAccountId, "en-US")
          .pipe(
            Effect.provide(
              CustomerLocalePreference.Default.pipe(Layer.provide(dependencies))
            )
          )
      : saveAccountLocalePreference(sectionAccountId, "en-US").pipe(
          Effect.provide(dependencies)
        )
  ).pipe(Effect.result, Effect.runPromise);
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
describe("CustomerLocalePreference", () => {
  const saveThroughService = (fixture: CustomerAccountSectionsFixture) =>
    save(fixture, {
      through: (accountId, locale) =>
        Effect.flatMap(CustomerLocalePreference, (preference) =>
          preference.save(accountId, locale)
        ),
    });

  test("saves through the account's section", async () => {
    const { run, writes } = saveThroughService({ session: {} });

    expect(Result.isSuccess(await run)).toBe(true);
    expect(writes).toEqual(["en-US"]);
  });

  test("refuses a deletion-marked account without writing", async () => {
    const { run, writes } = saveThroughService({
      session: {},
      activityState: "deletion-requested",
    });

    const outcome = await run;
    expect(Result.isFailure(outcome) && outcome.failure).toMatchObject({
      reason: "link-required",
      linkReason: "deletion-requested",
    });
    expect(writes).toEqual([]);
  });
});
