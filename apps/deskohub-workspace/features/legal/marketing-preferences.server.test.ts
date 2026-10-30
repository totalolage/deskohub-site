import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Logger, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { IMarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
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
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";

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

const requestCookies = mock(
  (): Promise<never> =>
    Promise.reject(new Error("synthetic request scope loss"))
);
mock.module("next/headers", () => ({ cookies: requestCookies }));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string, _options?: { readonly boundary?: string }) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
}));

const { getMarketingPreferences, getMarketingPreferencesEffect } = await import(
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
  readonly consent?: MarketingConsentStatus;
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

  const ledger: IMarketingConsentLedger = {
    status: mock(() =>
      options?.repositoryError
        ? Effect.fail(new Error("ledger unavailable") as never)
        : Effect.succeed(options?.consent ?? "absent")
    ),
    record: mock(() => Effect.die("not used in a read")),
    withdrawActive: mock(() => Effect.die("not used in a read")),
  };

  return {
    accountResolveCalls,
    layers: Layer.mergeAll(
      Layer.mock(CustomerAccountResolver, accountResolver),
      Layer.succeed(MarketingManagementService, management),
      Layer.succeed(MarketingConsentLedger, ledger)
    ),
    management,
    ledger,
    resolve,
  };
};

beforeEach(() => {
  cookieState = { pending: undefined, session: undefined };
  readMarketingManagementCookies.mockImplementation(readDefaultCookies);
  readMarketingManagementCookies.mockClear();
});

describe("getMarketingPreferences", () => {
  test("renders unavailable when the request cookie store rejects", async () => {
    await expect(getMarketingPreferences("en-US")).resolves.toEqual({
      status: "unavailable",
    });
    expect(readMarketingManagementCookies).not.toHaveBeenCalled();
  });

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
    expect(scenario.ledger.status).not.toHaveBeenCalled();
  });

  test("uses a valid management session and returns the customer consent state", async () => {
    cookieState = { pending: undefined, session: sessionToken };
    const scenario = makeScenario({ consent: "active" });

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
    expect(scenario.ledger.status).toHaveBeenCalledWith(customerId);
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
    expect(scenario.ledger.status).not.toHaveBeenCalled();
  });

  test.each([["withdrawn", "withdrawn"]] as const)(
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

    expect(scenario.ledger.status).not.toHaveBeenCalled();
  });

  test("logs a fixed, cause-free warning when it fails closed", async () => {
    const scenario = makeScenario({ repositoryError: true });
    const records: { readonly level: string; readonly text: string }[] = [];
    const capturingLogger = Logger.make(({ logLevel, message }) => {
      records.push({ level: logLevel, text: JSON.stringify(message) });
    });

    await expect(
      getMarketingPreferencesEffect(
        "en-US",
        marketingCookies,
        scenario.layers
      ).pipe(Effect.withLogger(capturingLogger), Effect.runPromise)
    ).resolves.toEqual({ status: "unavailable" });

    expect(records.some(({ level }) => level === "Warn")).toBe(true);
    expect(JSON.stringify(records)).not.toContain("ledger unavailable");
  });
});
