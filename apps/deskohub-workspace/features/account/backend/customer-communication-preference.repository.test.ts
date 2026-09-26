import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { CustomerAccountId } from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerCommunicationPreferenceRepository } from "./customer-communication-preference.repository";

type ActivityState =
  | { readonly kind: "missing" }
  | {
      readonly kind: "active";
      readonly deletionRequestedAt: Date | null;
    };

type PreferenceRow = {
  readonly locale: "cs-CZ" | "en-US";
};

const makeTestLayers = (options: {
  readonly state: ActivityState;
  readonly row?: PreferenceRow;
  readonly lockFails?: boolean;
}) => {
  const upserts: {
    readonly accountId: CustomerAccountId;
    readonly locale: "cs-CZ" | "en-US";
  }[] = [];

  const linksFindActivityState = (accountId: CustomerAccountId) =>
    Effect.succeed(options.state);

  const LinksLayer = Layer.succeed(
    CustomerAccountLinkRepository,
    CustomerAccountLinkRepository.of({
      findActivityState: linksFindActivityState,
      withAccountLock: <A, E, R>(
        _accountId: CustomerAccountId,
        effect: Effect.Effect<A, E, R>
      ) =>
        (options.lockFails
          ? Effect.fail("lock-failure" as never)
          : Effect.suspend(() => effect)) as Effect.Effect<A, E, R>,
    })
  );

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed(options.row ? [options.row] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: {
        customerAccountId: CustomerAccountId;
        locale: "cs-CZ" | "en-US";
      }) => ({
        onConflictDoUpdate: () =>
          Effect.sync(() => {
            upserts.push({
              accountId: values.customerAccountId,
              locale: values.locale,
            });
          }),
      }),
    }),
  };

  const DbLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: fakeDb as never })
  );

  const Repository = CustomerCommunicationPreferenceRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(DbLayer, LinksLayer))
  );

  return { Repository, upserts };
};

const accountId = "pref-account-1" as CustomerAccountId;

describe("CustomerCommunicationPreferenceRepository with mock layers", () => {
  test("distinguishes a missing row from a saved row on load", async () => {
    const missing = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
    });
    const saved = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
      row: { locale: "cs-CZ" },
    });

    const missingLoad = await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.load(accountId)
      ).pipe(Effect.provide(missing.Repository))
    );
    const savedLoad = await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.load(accountId)
      ).pipe(Effect.provide(saved.Repository))
    );

    expect(missingLoad).toBeUndefined();
    expect(savedLoad).toBe("cs-CZ");
  });

  test("fails closed with the deletion-pending error and never writes under a deletion marker", async () => {
    const { Repository, upserts } = makeTestLayers({
      state: {
        kind: "active",
        deletionRequestedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    const outcome = await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.save(accountId, "cs-CZ")
      ).pipe(Effect.result, Effect.provide(Repository))
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as CustomerAccountAccessErrorLike;
      expect(failure.reason).toBe("link-required");
      expect(failure.linkReason).toBe("deletion-requested");
    }
    expect(upserts).toHaveLength(0);
  });

  test("maps a lock failure to the fixed unavailable access error without writing", async () => {
    const { Repository, upserts } = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
      lockFails: true,
    });

    const outcome = await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.save(accountId, "en-US")
      ).pipe(Effect.result, Effect.provide(Repository))
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as CustomerAccountAccessErrorLike;
      expect(failure.reason).toBe("unavailable");
    }
    expect(upserts).toHaveLength(0);
  });

  test("writes the upsert for an active account", async () => {
    const { Repository, upserts } = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
    });

    await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.save(accountId, "en-US")
      ).pipe(Effect.provide(Repository))
    );

    expect(upserts).toEqual([{ accountId, locale: "en-US" }]);
  });
});

type CustomerAccountAccessErrorLike = {
  readonly reason: string;
  readonly linkReason?: string;
};
