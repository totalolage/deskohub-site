import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { decodeCustomerAccountSession } from "./customer-authentication.service";

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
