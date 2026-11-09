import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
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
            : Effect.fail(
                new CustomerAccountAccessError({ reason: "unavailable" })
              );
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

  test("derives hex contexts that do not contain raw identities", () => {
    const pendingContext = getPendingMarketingManagementContext("pending");
    const linkContext = getLinkMarketingManagementContext(
      "session",
      "customer"
    );
    const accountContext = getAccountMarketingManagementContext(
      accountId,
      "customer"
    );

    for (const context of [pendingContext, linkContext, accountContext]) {
      expect(context).toMatch(/^[0-9a-f]{64}$/);
      expect(context).not.toContain("pending");
      expect(context).not.toContain("session");
      expect(context).not.toContain("customer");
      expect(context).not.toContain("account");
    }
  });

  test("keeps contexts distinct across identity boundaries and kinds", () => {
    const shiftedIdentities = [
      [
        getLinkMarketingManagementContext("a", "bc"),
        getLinkMarketingManagementContext("ab", "c"),
      ],
      [
        getAccountMarketingManagementContext("a" as never, "bc"),
        getAccountMarketingManagementContext("ab" as never, "c"),
      ],
      [
        getLinkMarketingManagementContext("session", "customer"),
        getAccountMarketingManagementContext("session" as never, "customer"),
      ],
      [
        getMarketingManagementDismissalContext({
          pending: "token",
          session: undefined,
        }),
        getMarketingManagementDismissalContext({
          pending: undefined,
          session: "token",
        }),
      ],
    ];

    for (const [left, right] of shiftedIdentities) {
      expect(left).not.toBe(right);
    }
  });
});
