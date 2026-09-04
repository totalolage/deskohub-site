import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { CustomerAccountAccessError } from "../customer-account";
import {
  CustomerAuthentication,
  type CustomerAuthenticationEnvironment,
  decodeCustomerAccountSession,
} from "./customer-authentication.service";

type TestUserFields = {
  readonly id?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly deletionRequestedAt?: Date | null;
};

const sessionFor = (user: TestUserFields) => ({
  session: {
    id: "session-1",
    token: "token-1",
    expiresAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: user.id ?? "auth-user-1",
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: "auth-user-1",
    name: "",
    email: "ada@example.test",
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...user,
  },
});

const runDecode = (
  session: Parameters<typeof decodeCustomerAccountSession>[0]
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* decodeCustomerAccountSession(session);
    }).pipe(Effect.result)
  );

describe("CustomerAuthentication session adapter", () => {
  test("maps an authoritative Better Auth session to the closed domain shape", async () => {
    const outcome = await runDecode(sessionFor({ deletionRequestedAt: null }));

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      const session = outcome.success;
      expect(session).not.toBeNull();
      expect(session!.accountId).toBe("auth-user-1");
      expect(session!.email).toBe("ada@example.test");
      expect(session!.deletionRequested).toBe(false);
    }
  });

  test("surfaces the deletion marker without exposing Better Auth fields", async () => {
    const outcome = await runDecode(
      sessionFor({ deletionRequestedAt: new Date("2026-09-01T00:00:00Z") })
    );

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success!.deletionRequested).toBe(true);
      expect(Object.keys(outcome.success!).sort()).toEqual([
        "accountId",
        "deletionRequested",
        "email",
      ]);
    }
  });

  test("maps missing sessions to null", async () => {
    const outcome = await runDecode(null);
    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success).toBeNull();
    }
  });

  test("rejects unverified email addresses", async () => {
    const outcome = await runDecode(sessionFor({ emailVerified: false }));

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as { reason?: string };
      expect(error.reason).toBe("unverified-email");
    }
  });

  test("rejects malformed identifiers or emails as unauthenticated", async () => {
    const blankId = await runDecode(sessionFor({ id: "   " }));
    expect(blankId._tag).toBe("Failure");
    if (blankId._tag === "Failure") {
      expect((blankId.failure as { reason?: string }).reason).toBe(
        "unauthenticated"
      );
    }

    const invalidEmail = await runDecode(sessionFor({ email: "not-an-email" }));
    expect(invalidEmail._tag).toBe("Failure");
    if (invalidEmail._tag === "Failure") {
      expect((invalidEmail.failure as { reason?: string }).reason).toBe(
        "unauthenticated"
      );
    }
  });
});

// Synthetic and strong enough to pass the real configured-secrets gate.
const configuredSecretsRaw =
  "1:test-only-strong-secret-value-9f2c7a41b8e6d530417c";

const runCurrentUser = (environment: CustomerAuthenticationEnvironment) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      return yield* authentication.currentUser;
    }).pipe(
      Effect.provide(CustomerAuthentication.fromEnvironment(environment)),
      Effect.result
    )
  );

describe("CustomerAuthentication environment classification", () => {
  test("classifies absent Better Auth secrets as not-configured without reading a session", async () => {
    let sessionReads = 0;
    const readCurrentSession = () => {
      sessionReads += 1;
      return Promise.reject(new Error("session authority rejected"));
    };

    const absent = await runCurrentUser({
      readBetterAuthSecretsRaw: () => undefined,
      readCurrentSession,
    });
    expect(absent._tag).toBe("Failure");
    if (absent._tag === "Failure") {
      const error = absent.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("not-configured");
    }

    const blank = await runCurrentUser({
      readBetterAuthSecretsRaw: () => "   ",
      readCurrentSession,
    });
    expect(blank._tag).toBe("Failure");
    if (blank._tag === "Failure") {
      const error = blank.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("not-configured");
    }

    expect(sessionReads).toBe(0);
  });

  test("fails closed as unavailable with the fixed session code when the configured session read rejects", async () => {
    const outcome = await runCurrentUser({
      readBetterAuthSecretsRaw: () => configuredSecretsRaw,
      readCurrentSession: () =>
        Promise.reject(new Error('relation "auth"."user" does not exist')),
    });

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("unavailable");
      expect(error.cause?.code).toBe("authentication.session");
      expect(JSON.stringify(error)).not.toContain("does not exist");
    }
  });

  test("fails closed as unavailable when configured secrets are invalid", async () => {
    let sessionReads = 0;
    const outcome = await runCurrentUser({
      readBetterAuthSecretsRaw: () => "1:too-weak",
      readCurrentSession: () => {
        sessionReads += 1;
        return Promise.resolve(null);
      },
    });

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("unavailable");
      expect(error.cause?.code).toBe("authentication.session");
    }
    expect(sessionReads).toBe(0);
  });

  test("keeps unverified-email handling for a configured readable session", async () => {
    const outcome = await runCurrentUser({
      readBetterAuthSecretsRaw: () => configuredSecretsRaw,
      readCurrentSession: () =>
        Promise.resolve(sessionFor({ emailVerified: false })),
    });

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const error = outcome.failure as CustomerAccountAccessError;
      expect(error.reason).toBe("unverified-email");
    }
  });
});
