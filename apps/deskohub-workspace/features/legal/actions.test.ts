import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Layer, Schema } from "effect";
import type { CustomerMarketingConsent } from "@/db/schema/customer-marketing-consents";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  customerAccountIdSchema,
  type LinkedCustomerAccount,
} from "@/features/account/customer-account";
import type {
  GrantCustomerMarketingConsentInput,
  ICustomerMarketingConsentRepository,
} from "@/features/legal/backend/customer-marketing-consent.repository";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import type { IMarketingManagementService } from "@/features/legal/backend/marketing-management.service";
import {
  MarketingManagementError,
  MarketingManagementService,
} from "@/features/legal/backend/marketing-management.service";
import type { MarketingManagementCookieStore } from "@/features/legal/backend/marketing-management-cookies.server";
import type { MarketingManagementCookies } from "@/features/legal/backend/marketing-preferences-authority";
import {
  getAccountMarketingManagementContext,
  getLinkMarketingManagementContext,
  getMarketingManagementDismissalContext,
  getPendingMarketingManagementContext,
} from "@/features/legal/backend/marketing-preferences-authority";

mock.module("server-only", () => ({}));

const cookieStore = {};
let rejectAmbientCookieLookups = false;
let ambientCookieLookupCount = 0;
const requestCookies = mock(async () => {
  ambientCookieLookupCount += 1;
  if (rejectAmbientCookieLookups && ambientCookieLookupCount > 1) {
    throw new Error("ambient cookie lookup after exchange");
  }
  return cookieStore;
});

mock.module("next/headers", () => ({ cookies: requestCookies }));

type ActionResult = {
  readonly data?: unknown;
  readonly serverError?: string;
};

type SaveActionInput = {
  readonly confirmed: true;
  readonly context: string;
  readonly granted: boolean;
  readonly locale: "en-US" | "cs-CZ";
  readonly source: "link" | "account";
};

type ManagementActionInput = { readonly context: string };

type ActionInput = SaveActionInput | ManagementActionInput;

type ActionOptions = {
  readonly logInput?: boolean;
  readonly operation: string;
  readonly schema: StandardSchemaV1;
};

type ActionHandler = (
  input: ActionInput,
  context: { readonly clientInput: ActionInput; readonly locale: "en-US" }
) => Effect.Effect<
  { readonly status: "saved" | "confirmed" | "cleared" },
  Error,
  never
>;

mock.module("@/shared/backend/workspace-action", () => ({
  defineWorkspaceAction:
    (_options: ActionOptions, handler: ActionHandler) =>
    async (input: ActionInput): Promise<ActionResult> => {
      try {
        const data = await Effect.runPromise(
          handler(input, { clientInput: input, locale: "en-US" })
        );
        return { data };
      } catch (error) {
        return {
          serverError:
            error instanceof Error
              ? error.message
              : "We could not update your marketing preference. Please try again.",
        };
      }
    },
}));

let currentScenario: Scenario;

const readMarketingManagementCookies = mock(
  async (): Promise<MarketingManagementCookies> => ({
    ...currentScenario.cookies,
  })
);
const readDefaultCookies = async (): Promise<MarketingManagementCookies> => ({
  ...currentScenario.cookies,
});
const setMarketingManagementSessionCookie = mock(
  async ({ token }: { readonly token: string; readonly expiresAt: Date }) => {
    currentScenario.cookies = { pending: undefined, session: token };
  }
);
const clearMarketingManagementCookies = mock(async () => {
  currentScenario.cookies = { pending: undefined, session: undefined };
});

mock.module(
  "@/features/legal/backend/marketing-management-cookies.server",
  () => ({
    createMarketingManagementCookies: (
      _store: MarketingManagementCookieStore
    ) => ({
      clearMarketingManagementCookies,
      readMarketingManagementCookies,
      setMarketingManagementSessionCookie,
    }),
  })
);

const customerId = Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
  "customer-a"
);
const accountId: CustomerAccountId = Schema.decodeUnknownSync(
  customerAccountIdSchema
)("account-a");
const sessionToken = "session-token";
const pendingToken = "pending-token";
const sessionExpiry = new Date("2030-01-02T03:04:05.678Z");

type Scenario = {
  cookies: MarketingManagementCookies;
  readonly accountCustomerId: typeof customerId;
  readonly accountResolveCalls: { value: number };
  readonly consent: CustomerMarketingConsent | null;
  readonly exchange: ReturnType<typeof mock>;
  readonly grant: ReturnType<typeof mock>;
  readonly resolve: ReturnType<typeof mock>;
  readonly revoke: ReturnType<typeof mock>;
  readonly withdraw: ReturnType<typeof mock>;
};

const makeScenario = (options?: {
  readonly accountCustomerId?: typeof customerId;
  readonly consent?: CustomerMarketingConsent | null;
  readonly sessionCustomerId?: typeof customerId;
  readonly sessionError?: "invalid_credential" | "unavailable";
}): Scenario => {
  const accountResolveCalls = { value: 0 };
  const resolve = mock((_rawCookie: string) =>
    options?.sessionError
      ? Effect.fail(
          new MarketingManagementError({ reason: options.sessionError })
        )
      : Effect.succeed(options?.sessionCustomerId ?? customerId)
  );
  const exchange = mock((_rawToken: string) =>
    Effect.succeed({ token: "new-session-token", expiresAt: sessionExpiry })
  );
  const revoke = mock((_rawCookie: string) => Effect.void);
  const grant = mock(
    (_input: GrantCustomerMarketingConsentInput) => Effect.void
  );
  const withdraw = mock(
    (_input: GrantCustomerMarketingConsentInput) => Effect.void
  );

  return {
    accountCustomerId: options?.accountCustomerId ?? customerId,
    accountResolveCalls,
    consent: options?.consent ?? null,
    cookies: { pending: undefined, session: undefined },
    exchange,
    grant,
    resolve,
    revoke,
    withdraw,
  };
};

const management: IMarketingManagementService = {
  exchange: (rawToken) => currentScenario.exchange(rawToken),
  issue: () => Effect.succeed(pendingToken),
  resolve: (rawCookie) => currentScenario.resolve(rawCookie),
  revoke: (rawCookie) => currentScenario.revoke(rawCookie),
};

const accountResolver = {
  resolve: Effect.suspend(() => {
    currentScenario.accountResolveCalls.value += 1;
    const account: LinkedCustomerAccount = {
      accountId,
      dotyposCustomerId: currentScenario.accountCustomerId,
    };
    return Effect.succeed(account);
  }),
};

const repository: ICustomerMarketingConsentRepository = {
  get: (_customerId) => Effect.succeed(currentScenario.consent),
  grant: (input) => currentScenario.grant(input),
  grantInitial: (_input) => Effect.void,
  withdraw: (input) => currentScenario.withdraw(input),
};

const originalCustomerAccountResolverLive = CustomerAccountResolver.Live;
const originalMarketingManagementDefault = MarketingManagementService.Default;
const originalCustomerMarketingConsentDefault =
  CustomerMarketingConsentRepository.Default;

CustomerAccountResolver.Live = Layer.succeed(
  CustomerAccountResolver,
  accountResolver
);
MarketingManagementService.Default = Layer.succeed(
  MarketingManagementService,
  management
);
CustomerMarketingConsentRepository.Default = Layer.succeed(
  CustomerMarketingConsentRepository,
  repository
);

const {
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
} = await import("./actions");

beforeEach(() => {
  currentScenario = makeScenario();
  readMarketingManagementCookies.mockImplementation(readDefaultCookies);
  readMarketingManagementCookies.mockClear();
  setMarketingManagementSessionCookie.mockClear();
  clearMarketingManagementCookies.mockClear();
  requestCookies.mockClear();
  rejectAmbientCookieLookups = false;
  ambientCookieLookupCount = 0;
});

afterAll(() => {
  CustomerAccountResolver.Live = originalCustomerAccountResolverLive;
  MarketingManagementService.Default = originalMarketingManagementDefault;
  CustomerMarketingConsentRepository.Default =
    originalCustomerMarketingConsentDefault;
});

describe("marketing preference actions", () => {
  test("confirms the current pending token and installs a session cookie", async () => {
    currentScenario.cookies = { pending: pendingToken, session: undefined };

    await expect(
      confirmMarketingManagementAction({
        context: getPendingMarketingManagementContext(pendingToken),
      })
    ).resolves.toEqual({ data: { status: "confirmed" } });

    expect(currentScenario.exchange).toHaveBeenCalledWith(pendingToken);
    expect(setMarketingManagementSessionCookie).toHaveBeenCalledWith({
      token: "new-session-token",
      expiresAt: sessionExpiry,
    });
    expect(currentScenario.cookies).toEqual({
      pending: undefined,
      session: "new-session-token",
    });
    expect(requestCookies).toHaveBeenCalledTimes(1);
  });

  test("captures the cookie store before an asynchronous exchange and never calls ambient cookies again", async () => {
    currentScenario.cookies = { pending: pendingToken, session: undefined };
    currentScenario.exchange.mockImplementation(() =>
      Effect.promise(
        async () =>
          await Promise.resolve({
            token: "new-session-token",
            expiresAt: sessionExpiry,
          })
      )
    );
    rejectAmbientCookieLookups = true;

    await expect(
      confirmMarketingManagementAction({
        context: getPendingMarketingManagementContext(pendingToken),
      })
    ).resolves.toEqual({ data: { status: "confirmed" } });

    expect(requestCookies).toHaveBeenCalledTimes(1);
    expect(setMarketingManagementSessionCookie).toHaveBeenCalledTimes(1);
  });

  test("does not exchange a stale pending context", async () => {
    currentScenario.cookies = { pending: pendingToken, session: undefined };

    await expect(
      confirmMarketingManagementAction({
        context: getPendingMarketingManagementContext("different-token"),
      })
    ).resolves.toEqual({
      serverError:
        "This marketing preference context is no longer current. Refresh the page and try again.",
    });
    expect(currentScenario.exchange).not.toHaveBeenCalled();
    expect(setMarketingManagementSessionCookie).not.toHaveBeenCalled();
  });

  test("grants consent through the authoritative signed-in account", async () => {
    await expect(
      saveMarketingPreferencesAction({
        confirmed: true,
        context: getAccountMarketingManagementContext(accountId, customerId),
        granted: true,
        locale: "en-US",
        source: "account",
      })
    ).resolves.toEqual({ data: { status: "saved" } });

    expect(currentScenario.grant).toHaveBeenCalledTimes(1);
    expect(currentScenario.grant.mock.calls[0]?.[0]).toMatchObject({
      dotyposCustomerId: customerId,
      locale: "en-US",
    });
    expect(currentScenario.withdraw).not.toHaveBeenCalled();
  });

  test("withdraws consent through a valid management session without account fallback", async () => {
    currentScenario.cookies = { pending: undefined, session: sessionToken };

    await expect(
      saveMarketingPreferencesAction({
        confirmed: true,
        context: getLinkMarketingManagementContext(sessionToken, customerId),
        granted: false,
        locale: "cs-CZ",
        source: "link",
      })
    ).resolves.toEqual({ data: { status: "saved" } });

    expect(currentScenario.withdraw).toHaveBeenCalledTimes(1);
    expect(currentScenario.grant).not.toHaveBeenCalled();
    expect(currentScenario.accountResolveCalls.value).toBe(0);
  });

  test("rejects saving while a pending link still needs confirmation", async () => {
    currentScenario.cookies = { pending: pendingToken, session: undefined };

    await expect(
      saveMarketingPreferencesAction({
        confirmed: true,
        context: getPendingMarketingManagementContext(pendingToken),
        granted: true,
        locale: "en-US",
        source: "link",
      })
    ).resolves.toEqual({
      serverError:
        "Confirm this management link before saving a marketing preference.",
    });
    expect(currentScenario.grant).not.toHaveBeenCalled();
    expect(currentScenario.withdraw).not.toHaveBeenCalled();
  });

  test("rejects a changed link context before writing consent", async () => {
    let reads = 0;
    readMarketingManagementCookies.mockImplementation(async () => {
      reads += 1;
      return {
        pending: undefined,
        session: reads === 1 ? sessionToken : "new-session-token",
      };
    });

    await expect(
      saveMarketingPreferencesAction({
        confirmed: true,
        context: getLinkMarketingManagementContext(sessionToken, customerId),
        granted: true,
        locale: "en-US",
        source: "link",
      })
    ).resolves.toEqual({
      serverError:
        "This marketing preference context is no longer current. Refresh the page and try again.",
    });
    expect(currentScenario.grant).not.toHaveBeenCalled();
  });

  test("revokes a valid link session before clearing both management cookies", async () => {
    currentScenario.cookies = { pending: undefined, session: sessionToken };

    await expect(
      clearMarketingManagementAction({
        context: getMarketingManagementDismissalContext(
          currentScenario.cookies
        ),
      })
    ).resolves.toEqual({ data: { status: "cleared" } });

    expect(currentScenario.revoke).toHaveBeenCalledWith(sessionToken);
    expect(clearMarketingManagementCookies).toHaveBeenCalledTimes(1);
    expect(currentScenario.cookies).toEqual({
      pending: undefined,
      session: undefined,
    });
  });

  test("clears a pending context without exchanging or resolving it", async () => {
    currentScenario.cookies = { pending: pendingToken, session: undefined };

    await expect(
      clearMarketingManagementAction({
        context: getMarketingManagementDismissalContext(
          currentScenario.cookies
        ),
      })
    ).resolves.toEqual({ data: { status: "cleared" } });

    expect(currentScenario.resolve).not.toHaveBeenCalled();
    expect(currentScenario.exchange).not.toHaveBeenCalled();
    expect(currentScenario.revoke).not.toHaveBeenCalled();
    expect(clearMarketingManagementCookies).toHaveBeenCalledTimes(1);
  });

  test("clears malformed pending management state without resolving a credential", async () => {
    currentScenario.cookies = { pending: "invalid", session: undefined };

    await expect(
      clearMarketingManagementAction({
        context: getMarketingManagementDismissalContext(
          currentScenario.cookies
        ),
      })
    ).resolves.toEqual({ data: { status: "cleared" } });

    expect(currentScenario.resolve).not.toHaveBeenCalled();
    expect(currentScenario.revoke).not.toHaveBeenCalled();
    expect(clearMarketingManagementCookies).toHaveBeenCalledTimes(1);
  });

  test("clears a retained session cookie when its credential is already revoked", async () => {
    currentScenario.cookies = { pending: undefined, session: sessionToken };
    currentScenario.revoke.mockImplementation(() =>
      Effect.fail(
        new MarketingManagementError({ reason: "invalid_credential" })
      )
    );

    await expect(
      clearMarketingManagementAction({
        context: getMarketingManagementDismissalContext(
          currentScenario.cookies
        ),
      })
    ).resolves.toEqual({ data: { status: "cleared" } });

    expect(currentScenario.resolve).not.toHaveBeenCalled();
    expect(currentScenario.revoke).toHaveBeenCalledWith(sessionToken);
    expect(clearMarketingManagementCookies).toHaveBeenCalledTimes(1);
  });

  test("rejects a stale dismissal context without revoking or clearing", async () => {
    currentScenario.cookies = { pending: undefined, session: sessionToken };

    await expect(
      clearMarketingManagementAction({
        context: getMarketingManagementDismissalContext({
          pending: undefined,
          session: "different-session",
        }),
      })
    ).resolves.toEqual({
      serverError:
        "This marketing preference context is no longer current. Refresh the page and try again.",
    });

    expect(currentScenario.revoke).not.toHaveBeenCalled();
    expect(clearMarketingManagementCookies).not.toHaveBeenCalled();
  });

  test("allows a clear retry after a revoke response is lost", async () => {
    currentScenario.cookies = { pending: undefined, session: sessionToken };
    let revokeCalls = 0;
    currentScenario.revoke.mockImplementation(() => {
      revokeCalls += 1;
      return revokeCalls === 1
        ? Effect.fail(new MarketingManagementError({ reason: "unavailable" }))
        : Effect.void;
    });

    const input = {
      context: getMarketingManagementDismissalContext(currentScenario.cookies),
    };

    await expect(clearMarketingManagementAction(input)).resolves.toEqual({
      serverError:
        "We could not update your marketing preference. Please try again.",
    });
    expect(currentScenario.cookies).toEqual({
      pending: undefined,
      session: sessionToken,
    });

    await expect(clearMarketingManagementAction(input)).resolves.toEqual({
      data: { status: "cleared" },
    });
    expect(currentScenario.revoke).toHaveBeenCalledTimes(2);
    expect(clearMarketingManagementCookies).toHaveBeenCalledTimes(1);
  });
});
