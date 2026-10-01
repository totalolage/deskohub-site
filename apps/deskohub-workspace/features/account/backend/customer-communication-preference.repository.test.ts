import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { CustomerAccountId } from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
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
  readonly holdLock?: Promise<void>;
  readonly readFails?: boolean;
}) => {
  const upserts: {
    readonly accountId: CustomerAccountId;
    readonly locale: "cs-CZ" | "en-US";
  }[] = [];
  let sessionAccountId: CustomerAccountId | null = accountId;
  let authReads = 0;

  const linksFindActivityState = (_accountId: CustomerAccountId) =>
    Effect.succeed(options.state);

  const LinksLayer = Layer.succeed(
    CustomerAccountLinkRepository,
    CustomerAccountLinkRepository.of({
      findActivityState: linksFindActivityState,
      withAccountLock: <A, E, R>(
        _accountId: CustomerAccountId,
        effect: Effect.Effect<A, E, R>
      ) => {
        if (options.lockFails)
          return Effect.fail("lock-failure" as never) as Effect.Effect<A, E, R>;
        if (options.holdLock)
          return Effect.flatMap(
            Effect.promise(() => options.holdLock),
            () => effect
          ) as Effect.Effect<A, E, R>;
        return Effect.suspend(() => effect) as Effect.Effect<A, E, R>;
      },
    })
  );

  const AuthenticationLayer = Layer.succeed(
    CustomerAuthentication,
    CustomerAuthentication.of({
      currentUser: Effect.suspend(() => {
        authReads += 1;
        const session: CustomerAccountSession | null =
          sessionAccountId === null ? null : makeSession(sessionAccountId);
        return Effect.succeed(session);
      }),
    })
  );

  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            options.readFails
              ? Effect.fail(new Error("synthetic preference read failure"))
              : Effect.succeed(options.row ? [options.row] : []),
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
    Layer.provide(Layer.mergeAll(DbLayer, LinksLayer, AuthenticationLayer))
  );

  return {
    Repository,
    upserts,
    revokeSession: () => {
      sessionAccountId = null;
    },
    authReads: () => authReads,
  };
};

const makeSession = (accountId: CustomerAccountId): CustomerAccountSession => ({
  accountId,
  email: `pref-${accountId}@deskohub.test`,
  deletionRequested: false,
});

const accountId = "pref-account-1" as CustomerAccountId;

describe("CustomerCommunicationPreferenceRepository with mock layers", () => {
  test("fails the load with the typed missing error when no row exists", async () => {
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
      ).pipe(Effect.result, Effect.provide(missing.Repository))
    );
    const savedLoad = await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.load(accountId)
      ).pipe(Effect.provide(saved.Repository))
    );

    expect(missingLoad._tag).toBe("Failure");
    if (missingLoad._tag === "Failure") {
      expect((missingLoad.failure as { readonly code?: string }).code).toBe(
        "account-communication-preference.missing"
      );
    }
    expect(savedLoad).toBe("cs-CZ");
  });

  test("keeps an operational read failure distinguishable from a missing row", async () => {
    const readFailed = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
      readFails: true,
    });

    const outcome = await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.load(accountId)
      ).pipe(Effect.result, Effect.provide(readFailed.Repository))
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as unknown;
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(
        "synthetic preference read failure"
      );
      expect((failure as { readonly code?: string }).code).not.toBe(
        "account-communication-preference.missing"
      );
    }
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

  test("fails the read with the deletion-pending access error and never returns a locale", async () => {
    const { Repository } = makeTestLayers({
      state: {
        kind: "active",
        deletionRequestedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      row: { locale: "en-US" },
    });

    const outcome = await Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.load(accountId)
      ).pipe(Effect.result, Effect.provide(Repository))
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as CustomerAccountAccessErrorLike;
      expect(failure.reason).toBe("link-required");
      expect(failure.linkReason).toBe("deletion-requested");
    }
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

  test("rechecks the session under the lock and never writes for a revoked session", async () => {
    let releaseLock!: () => void;
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const { Repository, upserts, revokeSession, authReads } = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
      holdLock: lockGate,
    });

    const pendingSave = Effect.runPromise(
      Effect.flatMap(CustomerCommunicationPreferenceRepository, (repository) =>
        repository.save(accountId, "en-US")
      ).pipe(Effect.result, Effect.provide(Repository))
    );

    // The saver is parked on the lock gate. Revoke the session before the
    // lock is released so only the under-lock recheck can observe it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upserts).toHaveLength(0);
    revokeSession();
    releaseLock();

    const outcome = await pendingSave;

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as CustomerAccountAccessErrorLike;
      expect(failure.reason).toBe("unauthenticated");
    }
    expect(authReads()).toBe(1);
    expect(upserts).toHaveLength(0);
  });
});

type CustomerAccountAccessErrorLike = {
  readonly reason: string;
  readonly linkReason?: string;
};
