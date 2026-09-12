import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { MarketingManagementError } from "./marketing-management.service";
import {
  getAccountMarketingManagementContext,
  getLinkMarketingManagementContext,
  getMarketingManagementDismissalContext,
  getPendingMarketingManagementContext,
  MARKETING_MANAGEMENT_INVALID_COOKIE_SENTINEL,
  resolveMarketingPreferencesAuthority,
} from "./marketing-preferences-authority";

const accountId = "account-a" as never;

const account = (customerId: string) => ({
  accountId,
  dotyposCustomerId: customerId,
});

const resolve = (input: {
  readonly pending?: string;
  readonly session?: string;
  readonly accountCustomerId?: string;
  readonly linkCustomerId?: string;
  readonly linkFailure?: "invalid_credential" | "unavailable";
}) => {
  let accountCalls = 0;
  return {
    get accountCalls() {
      return accountCalls;
    },
    effect: resolveMarketingPreferencesAuthority(
      {
        pending: input.pending,
        session: input.session,
      },
      {
        resolveAccount: () => {
          accountCalls += 1;
          return input.accountCustomerId
            ? Effect.succeed(account(input.accountCustomerId))
            : Effect.fail(new Error("account unavailable"));
        },
        resolveManagementSession: () =>
          input.linkFailure
            ? Effect.fail(
                new MarketingManagementError({ reason: input.linkFailure })
              )
            : Effect.succeed(input.linkCustomerId ?? "customer-link"),
      }
    ),
  };
};

describe("marketing preference authority", () => {
  test("falls back to the verified account resolver only when no management cookie exists", async () => {
    const attempt = resolve({ accountCustomerId: "customer-a" });

    const authority = await Effect.runPromise(attempt.effect);

    expect(authority).toEqual({
      kind: "account",
      source: "account",
      accountId,
      customerId: "customer-a",
      context: getAccountMarketingManagementContext(accountId, "customer-a"),
    });
    expect(attempt.accountCalls).toBe(1);
  });

  test("uses a valid management session in preference to the account resolver", async () => {
    const attempt = resolve({
      accountCustomerId: "customer-a",
      session: "session-for-customer-b",
      linkCustomerId: "customer-b",
    });

    const authority = await Effect.runPromise(attempt.effect);

    expect(authority).toEqual({
      kind: "link",
      source: "link",
      rawSession: "session-for-customer-b",
      customerId: "customer-b",
      context: getLinkMarketingManagementContext(
        "session-for-customer-b",
        "customer-b"
      ),
    });
    expect(attempt.accountCalls).toBe(0);
  });

  test("turns an invalid management session into invalid-link without account fallback", async () => {
    const attempt = resolve({
      accountCustomerId: "customer-a",
      session: "expired-session",
      linkFailure: "invalid_credential",
    });

    const result = await Effect.runPromise(attempt.effect.pipe(Effect.result));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("MarketingPreferencesAuthorityError");
      expect(result.failure.reason).toBe("invalid-link");
    }
    expect(attempt.accountCalls).toBe(0);
  });

  test("keeps the account resolver out of a pending-link read", async () => {
    const attempt = resolve({
      accountCustomerId: "customer-a",
      pending: "pending-link-token",
    });

    const authority = await Effect.runPromise(attempt.effect);

    expect(authority).toEqual({
      kind: "pending",
      rawPending: "pending-link-token",
      context: getPendingMarketingManagementContext("pending-link-token"),
    });
    expect(attempt.accountCalls).toBe(0);
  });

  test("treats an invalid pending-cookie sentinel as invalid-link and blocks fallback", async () => {
    const attempt = resolve({
      accountCustomerId: "customer-a",
      pending: MARKETING_MANAGEMENT_INVALID_COOKIE_SENTINEL,
    });

    const result = await Effect.runPromise(attempt.effect.pipe(Effect.result));

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("MarketingPreferencesAuthorityError");
      expect(result.failure.reason).toBe("invalid-link");
    }
    expect(attempt.accountCalls).toBe(0);
  });

  test("uses NUL-separated SHA-256 contexts that do not contain raw identities", () => {
    const pendingContext = getPendingMarketingManagementContext("pending");
    const linkContext = getLinkMarketingManagementContext(
      "session",
      "customer"
    );
    const accountContext = getAccountMarketingManagementContext(
      accountId,
      "customer"
    );

    expect(pendingContext).toBe(
      "96066f7dd7ddfb6dbb12de414bfcdb149e6dfefcdfa84607fd89939841f68565"
    );
    expect(linkContext).toBe(
      "c7750056ea40f02078ddea50435ec62077e356aadca601f99b99d40c01c3bd50"
    );
    expect(accountContext).toBe(
      "5094ec593ba0abf77382fd7e2eeec5b68e33bb7887dc2ba55ffceb5d81ad1bad"
    );

    for (const context of [pendingContext, linkContext, accountContext]) {
      expect(context).toMatch(/^[0-9a-f]{64}$/);
      expect(context).not.toContain("pending");
      expect(context).not.toContain("session");
      expect(context).not.toContain("customer");
      expect(context).not.toContain("account");
    }
  });

  test("derives dismissal context from the exact raw management cookie pair", () => {
    const dismissalContext = getMarketingManagementDismissalContext({
      pending: "pending",
      session: undefined,
    });

    expect(dismissalContext).toBe(
      "54d5362f290b6d26d5753ded3d7f03af532b73217619786f1355ed0932e5025c"
    );
    expect(dismissalContext).toMatch(/^[0-9a-f]{64}$/);
    expect(dismissalContext).not.toContain("pending");
  });
});
