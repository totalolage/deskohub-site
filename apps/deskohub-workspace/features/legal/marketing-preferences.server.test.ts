import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type {
  CustomerMarketingConsent,
  ICustomerMarketingConsentRepository,
} from "@/features/legal/backend/customer-marketing-consent.repository";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import {
  type IMarketingManagementService,
  MarketingManagementError,
  MarketingManagementService,
} from "@/features/legal/backend/marketing-management.service";
import type { MarketingManagementCookieOperations } from "@/features/legal/backend/marketing-management-cookies.server";
import type { MarketingManagementCookies } from "@/features/legal/backend/marketing-preferences-authority";
import {
  getAccountMarketingManagementContext,
  getLinkMarketingManagementContext,
  getMarketingManagementDismissalContext,
  getPendingMarketingManagementContext,
} from "@/features/legal/backend/marketing-preferences-authority";

mock.module("server-only", () => ({}));

let cookieState: MarketingManagementCookies = {
  pending: undefined,
  session: undefined,
};

const readMarketingManagementCookies = mock(
  async (): Promise<MarketingManagementCookies> => ({ ...cookieState })
);
const readDefaultCookies = async (): Promise<MarketingManagementCookies> => ({
  ...cookieState,
});
const marketingCookies: MarketingManagementCookieOperations = {
  clearMarketingManagementCookies: async () => undefined,
  readMarketingManagementCookies,
  setMarketingManagementSessionCookie: async () => undefined,
  setPendingMarketingManagementCookie: async () => undefined,
};

const { getMarketingPreferencesEffect } = await import(
  "./marketing-preferences.server"
);

const customerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
  "customer-a"
);
const accountId: CustomerAccountId = Schema.decodeUnknownSync(
  customerAccountIdSchema
)("account-a");
const sessionToken = "session-token";
const pendingToken = "pending-token";

const makeScenario = (options?: {
  readonly accountError?: boolean;
  readonly accountCustomerId?: typeof customerId;
  readonly consent?: CustomerMarketingConsent | null;
  readonly repositoryError?: boolean;
  readonly sessionCustomerId?: typeof customerId;
  readonly sessionError?: "invalid_credential" | "unavailable";
}) => {
  const accountResolveCalls = { value: 0 };
  const accountResolver = {
    resolve: Effect.suspend(() => {
      accountResolveCalls.value += 1;
      return options?.accountError
        ? Effect.fail(new Error("account unavailable"))
        : Effect.succeed({
            accountId,
            dotyposCustomerId: options?.accountCustomerId ?? customerId,
          });
    }),
  };

  const resolve = mock((_rawCookie: string) =>
    options?.sessionError
      ? Effect.fail(
          new MarketingManagementError({ reason: options.sessionError })
        )
      : Effect.succeed(options?.sessionCustomerId ?? customerId)
  );
  const management: IMarketingManagementService = {
    exchange: mock(() => Effect.die("not used in a read")),
    issue: mock(() => Effect.die("not used in a read")),
    resolve,
    revoke: mock(() => Effect.die("not used in a read")),
  };

  const repository: ICustomerMarketingConsentRepository = {
    get: mock(() =>
      options?.repositoryError
        ? Effect.fail(new Error("repository unavailable"))
        : Effect.succeed(options?.consent ?? null)
    ),
    grant: mock(() => Effect.die("not used in a read")),
    grantInitial: mock(() => Effect.die("not used in a read")),
    withdraw: mock(() => Effect.die("not used in a read")),
  };

  return {
    accountResolveCalls,
    layers: Layer.mergeAll(
      Layer.succeed(CustomerAccountResolver, accountResolver),
      Layer.succeed(MarketingManagementService, management),
      Layer.succeed(CustomerMarketingConsentRepository, repository)
    ),
    management,
    repository,
    resolve,
  };
};

const consent = (
  withdrawnAt: Temporal.Instant | null
): CustomerMarketingConsent => ({
  dotyposCustomerId: customerId,
  documentHash: "synthetic-marketing-document-hash",
  locale: "en-US",
  grantedAt: Temporal.Instant.from("2030-01-01T00:00:00Z"),
  withdrawnAt,
});

beforeEach(() => {
  cookieState = { pending: undefined, session: undefined };
  readMarketingManagementCookies.mockImplementation(readDefaultCookies);
  readMarketingManagementCookies.mockClear();
});

describe("getMarketingPreferences", () => {
  test("renders pending-link before resolving either account or session authority", async () => {
    cookieState = { pending: pendingToken, session: sessionToken };
    const scenario = makeScenario();

    await expect(
      Effect.runPromise(
        getMarketingPreferencesEffect(
          "en-US",
          marketingCookies,
          scenario.layers
        )
      )
    ).resolves.toEqual({
      status: "pending-link",
      context: getPendingMarketingManagementContext(pendingToken),
      dismissalContext: getMarketingManagementDismissalContext(cookieState),
    });

    expect(scenario.accountResolveCalls.value).toBe(0);
    expect(scenario.resolve).not.toHaveBeenCalled();
    expect(scenario.repository.get).not.toHaveBeenCalled();
  });

  test("renders invalid-link for the malformed access sentinel without account fallback", async () => {
    cookieState = { pending: "invalid", session: undefined };
    const scenario = makeScenario();

    await expect(
      Effect.runPromise(
        getMarketingPreferencesEffect(
          "en-US",
          marketingCookies,
          scenario.layers
        )
      )
    ).resolves.toEqual({
      status: "invalid-link",
      dismissalContext: getMarketingManagementDismissalContext(cookieState),
    });

    expect(scenario.accountResolveCalls.value).toBe(0);
    expect(scenario.repository.get).not.toHaveBeenCalled();
  });

  test("uses a valid management session and returns the customer consent state", async () => {
    cookieState = { pending: undefined, session: sessionToken };
    const scenario = makeScenario({ consent: consent(null) });

    await expect(
      Effect.runPromise(
        getMarketingPreferencesEffect(
          "en-US",
          marketingCookies,
          scenario.layers
        )
      )
    ).resolves.toEqual({
      status: "active",
      source: "link",
      context: getLinkMarketingManagementContext(sessionToken, customerId),
      dismissalContext: getMarketingManagementDismissalContext(cookieState),
    });

    expect(scenario.resolve).toHaveBeenCalledWith(sessionToken);
    expect(scenario.accountResolveCalls.value).toBe(0);
    expect(scenario.repository.get).toHaveBeenCalledWith(customerId);
  });

  test("turns an expired management session into invalid-link without account fallback", async () => {
    cookieState = { pending: undefined, session: sessionToken };
    const scenario = makeScenario({ sessionError: "invalid_credential" });

    await expect(
      Effect.runPromise(
        getMarketingPreferencesEffect(
          "en-US",
          marketingCookies,
          scenario.layers
        )
      )
    ).resolves.toEqual({
      status: "invalid-link",
      dismissalContext: getMarketingManagementDismissalContext(cookieState),
    });

    expect(scenario.accountResolveCalls.value).toBe(0);
    expect(scenario.repository.get).not.toHaveBeenCalled();
  });

  test.each([
    ["absent", null],
    ["active", consent(null)],
    ["withdrawn", consent(Temporal.Instant.from("2030-01-02T00:00:00Z"))],
  ] as const)(
    "projects the account consent as %s",
    async (status, existingConsent) => {
      const scenario = makeScenario({ consent: existingConsent });

      await expect(
        Effect.runPromise(
          getMarketingPreferencesEffect(
            "cs-CZ",
            marketingCookies,
            scenario.layers
          )
        )
      ).resolves.toEqual({
        status,
        source: "account",
        context: getAccountMarketingManagementContext(accountId, customerId),
      });
    }
  );

  test("fails closed to unavailable when account authority cannot be resolved", async () => {
    const scenario = makeScenario({ accountError: true });

    await expect(
      Effect.runPromise(
        getMarketingPreferencesEffect(
          "en-US",
          marketingCookies,
          scenario.layers
        )
      )
    ).resolves.toEqual({ status: "unavailable" });

    expect(scenario.repository.get).not.toHaveBeenCalled();
  });

  test("fails closed to unavailable when consent storage cannot be read", async () => {
    const scenario = makeScenario({ repositoryError: true });

    await expect(
      Effect.runPromise(
        getMarketingPreferencesEffect(
          "en-US",
          marketingCookies,
          scenario.layers
        )
      )
    ).resolves.toEqual({ status: "unavailable" });
  });
});
