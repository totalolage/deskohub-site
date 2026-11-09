import { testEmailAddress } from "@deskohub/test-email";
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
import { saveAccountLocalePreference } from "./customer-locale-preference";

type ActivityState =
  | { readonly kind: "missing" }
  | {
      readonly kind: "active";
      readonly deletionRequestedAt: Date | null;
    };

const makeTestLayers = (options: {
  readonly state: ActivityState;
  readonly lockFails?: boolean;
  readonly holdLock?: Promise<void>;
}) => {
  const updates: {
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
    update: () => ({
      set: (values: { locale: "cs-CZ" | "en-US" }) => ({
        where: () =>
          Effect.sync(() => {
            updates.push({ accountId, locale: values.locale });
          }),
      }),
    }),
  };

  const DbLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make(fakeDb as never)
  );

  const Dependencies = Layer.mergeAll(DbLayer, LinksLayer, AuthenticationLayer);

  return {
    Dependencies,
    updates,
    revokeSession: () => {
      sessionAccountId = null;
    },
    authReads: () => authReads,
  };
};

const makeSession = (accountId: CustomerAccountId): CustomerAccountSession => ({
  accountId,
  email: testEmailAddress(`pref-${accountId}`),
  deletionRequested: false,
});

const accountId = "pref-account-1" as CustomerAccountId;

describe("saveAccountLocalePreference with mock layers", () => {
  test("maps a lock failure to the fixed unavailable access error without writing", async () => {
    const { Dependencies, updates } = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
      lockFails: true,
    });

    const outcome = await Effect.runPromise(
      saveAccountLocalePreference(accountId, "en-US").pipe(
        Effect.result,
        Effect.provide(Dependencies)
      )
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as CustomerAccountAccessErrorLike;
      expect(failure.reason).toBe("unavailable");
    }
    expect(updates).toHaveLength(0);
  });

  test("rechecks the session under the lock and never writes for a revoked session", async () => {
    let releaseLock!: () => void;
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const { Dependencies, updates, revokeSession, authReads } = makeTestLayers({
      state: { kind: "active", deletionRequestedAt: null },
      holdLock: lockGate,
    });

    const pendingSave = Effect.runPromise(
      saveAccountLocalePreference(accountId, "en-US").pipe(
        Effect.result,
        Effect.provide(Dependencies)
      )
    );

    // The saver is parked on the lock gate. Revoke the session before the
    // lock is released so only the under-lock recheck can observe it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updates).toHaveLength(0);
    revokeSession();
    releaseLock();

    const outcome = await pendingSave;

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as CustomerAccountAccessErrorLike;
      expect(failure.reason).toBe("unauthenticated");
    }
    expect(authReads()).toBe(1);
    expect(updates).toHaveLength(0);
  });
});

type CustomerAccountAccessErrorLike = {
  readonly reason: string;
  readonly linkReason?: string;
};
