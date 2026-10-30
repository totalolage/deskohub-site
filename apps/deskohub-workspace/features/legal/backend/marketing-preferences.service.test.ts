import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect, Layer, Result, Schema } from "effect";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  type LinkedCustomerAccount,
} from "@/features/account/customer-account";
import type { MarketingConsentStatus } from "../marketing-consent-status";
import {
  MarketingConsentLedger,
  type MarketingConsentRecord,
  MarketingConsentUnavailable,
} from "./marketing-consent-ledger";
import {
  MarketingManagementError,
  MarketingManagementService,
} from "./marketing-management.service";
import { MarketingManagementCookies } from "./marketing-management-cookies.service";
import { makeMemoryMarketingCookies } from "./marketing-management-cookies.service.mock";
import { MarketingPreferences } from "./marketing-preferences.service";
import {
  getAccountMarketingManagementContext,
  getLinkMarketingManagementContext,
  getMarketingManagementDismissalContext,
  getPendingMarketingManagementContext,
} from "./marketing-preferences-authority";

const customerA = Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
  "customer-a"
);
const customerB = Schema.decodeUnknownSync(DotyposCustomerIdSchema)(
  "customer-b"
);
const accountA = Schema.decodeUnknownSync(customerAccountIdSchema)("account-a");
const accountB = Schema.decodeUnknownSync(customerAccountIdSchema)("account-b");
const pending = "pending-link";
const session = "link-session";
const expiry = new Date("2030-01-02T03:04:05Z");
const invalid = () =>
  Effect.fail(new MarketingManagementError({ reason: "invalid_credential" }));

function scenario() {
  const memory = makeMemoryMarketingCookies();
  const state = {
    account: {
      accountId: accountA,
      dotyposCustomerId: customerA,
    } as LinkedCustomerAccount | null,
    accountReads: 0,
    sessionUnavailable: false,
    revokeUnavailable: false,
    ledgerUnavailable: false,
    exchanges: 0,
    revokes: 0,
    beforeAccount: () => {},
    onResolve: () => {},
    onExchange: () => {},
    onRevoke: () => {},
  };
  const sessions = new Map([[session, customerB]]);
  const links = new Set([pending]);
  const consents = new Map<typeof customerA, MarketingConsentStatus>();
  const records: MarketingConsentRecord[] = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(CustomerAccountResolver, {
      resolve: Effect.suspend(() => {
        state.accountReads++;
        state.beforeAccount();
        return state.account
          ? Effect.succeed(state.account)
          : Effect.fail(
              new CustomerAccountAccessError({ reason: "unauthenticated" })
            );
      }),
    }),
    Layer.succeed(MarketingManagementService, {
      issue: () => Effect.succeed(pending),
      resolve: (raw) =>
        Effect.suspend(() => {
          const customer = sessions.get(raw);
          state.onResolve();
          if (state.sessionUnavailable)
            return Effect.fail(
              new MarketingManagementError({ reason: "unavailable" })
            );
          return customer ? Effect.succeed(customer) : invalid();
        }),
      exchange: (raw) =>
        Effect.suspend(() => {
          state.exchanges++;
          if (!links.delete(raw)) return invalid();
          sessions.set("exchanged-session", customerB);
          state.onExchange();
          return Effect.succeed({
            token: "exchanged-session",
            expiresAt: expiry,
          });
        }),
      revoke: (raw) =>
        Effect.suspend(() => {
          state.revokes++;
          if (state.revokeUnavailable)
            return Effect.fail(
              new MarketingManagementError({ reason: "unavailable" })
            );
          const existed = sessions.delete(raw);
          state.onRevoke();
          return existed ? Effect.void : invalid();
        }),
    }),
    Layer.succeed(MarketingConsentLedger, {
      status: (customer) => Effect.succeed(consents.get(customer) ?? "absent"),
      record: (input) =>
        Effect.suspend(() => {
          if (state.ledgerUnavailable)
            return Effect.fail(
              new MarketingConsentUnavailable({
                cause: new Error("Synthetic unavailable ledger"),
              })
            );
          records.push(input);
          consents.set(
            input.customerId,
            input.choice === "grant" ? "active" : "withdrawn"
          );
          return Effect.void;
        }),
      withdrawActive: () => Effect.die("not used by preferences"),
    })
  );
  const layer = MarketingPreferences.Default.pipe(
    Layer.provideMerge(Layer.mergeAll(dependencies, memory.layer))
  );
  const run = <A, E>(
    use: (
      preferences: MarketingPreferences["Service"]
    ) => Effect.Effect<A, E, CustomerAccountResolver | MarketingConsentLedger>
  ) =>
    Effect.runPromise(
      Effect.flatMap(MarketingPreferences, use).pipe(Effect.provide(layer))
    );
  return {
    memory,
    state,
    sessions,
    links,
    consents,
    records,
    run,
    layer,
    dependencies,
  };
}

const saveAccount = {
  source: "account",
  context: getAccountMarketingManagementContext(accountA, customerA),
  granted: true,
  locale: "en-US",
} as const;
const saveLink = {
  ...saveAccount,
  source: "link",
  context: getLinkMarketingManagementContext(session, customerB),
} as const;
const confirm = { context: getPendingMarketingManagementContext(pending) };

async function expectUnavailable(
  effect: Promise<Result.Result<unknown, { readonly reason: string }>>
) {
  const result = await effect;
  expect(Result.isFailure(result) && result.failure.reason).toBe("unavailable");
}

describe("MarketingPreferences authority and consent", () => {
  test("pending wins over a valid session and signed-in account without reading either", async () => {
    const s = scenario();
    s.memory.state.pending = pending;
    s.memory.state.session = session;
    expect(await s.run((p) => p.read)).toEqual({
      status: "pending-link",
      ...confirm,
      dismissalContext: getMarketingManagementDismissalContext(s.memory.state),
    });
    expect(await s.run((p) => p.save(saveAccount))).toEqual({
      status: "rejected",
      reason: "pending-confirmation-required",
    });
    expect(s.state.accountReads).toBe(0);
    expect(s.records).toHaveLength(0);
    expect(s.state.exchanges).toBe(0);
  });

  test.each(["invalid", "", "expired-session"])(
    "invalid link authority never falls back to the account",
    async (raw) => {
      const s = scenario();
      s.memory.state.session = raw;
      expect(await s.run((p) => p.read)).toEqual({
        status: "invalid-link",
        dismissalContext: getMarketingManagementDismissalContext(
          s.memory.state
        ),
      });
      expect(await s.run((p) => p.save(saveAccount))).toEqual({
        status: "rejected",
        reason: "invalid-link",
      });
      expect(s.state.accountReads).toBe(0);
      expect(s.records).toHaveLength(0);
    }
  );

  test("invalid pending never resolves the session or signed-in account", async () => {
    const s = scenario();
    s.memory.state.pending = "invalid";
    s.memory.state.session = session;
    expect((await s.run((p) => p.read)).status).toBe("invalid-link");
    expect(await s.run((p) => p.confirm(confirm))).toEqual({
      status: "rejected",
      reason: "invalid-link",
    });
    expect(s.state.accountReads).toBe(0);
    expect(s.state.exchanges).toBe(0);
  });

  test("valid session writes only its customer, then exposes the resulting consent", async () => {
    const s = scenario();
    s.memory.state.session = session;
    expect(await s.run((p) => p.save(saveLink))).toEqual({ status: "saved" });
    expect(s.records).toEqual([
      {
        customerId: customerB,
        locale: "en-US",
        choice: "grant",
        mode: "explicit",
        channel: "link",
      },
    ]);
    expect(await s.run((p) => p.read)).toEqual({
      status: "active",
      source: "link",
      context: saveLink.context,
      dismissalContext: getMarketingManagementDismissalContext(s.memory.state),
    });
    expect(s.state.accountReads).toBe(0);
  });

  test("account grant and withdrawal use the current identity and ledger contract", async () => {
    const s = scenario();
    expect(await s.run((p) => p.save(saveAccount))).toEqual({
      status: "saved",
    });
    expect(
      await s.run((p) =>
        p.save({ ...saveAccount, granted: false, locale: "cs-CZ" })
      )
    ).toEqual({ status: "saved" });
    expect(s.records).toEqual([
      {
        customerId: customerA,
        locale: "en-US",
        choice: "grant",
        mode: "explicit",
        channel: "account",
      },
      { customerId: customerA, locale: "cs-CZ", choice: "withdraw" },
    ]);
    expect(await s.run((p) => p.read)).toEqual({
      status: "withdrawn",
      source: "account",
      context: saveAccount.context,
    });
  });

  test("changed account identity between authority reads prevents every consent write", async () => {
    const s = scenario();
    s.state.beforeAccount = () => {
      if (s.state.accountReads > 1)
        s.state.account = { accountId: accountB, dotyposCustomerId: customerB };
    };
    expect(await s.run((p) => p.save(saveAccount))).toEqual({
      status: "rejected",
      reason: "stale-context",
    });
    expect(s.records).toHaveLength(0);
  });

  test("changed cookie context during session resolution prevents a consent write", async () => {
    const s = scenario();
    s.memory.state.session = session;
    s.state.onResolve = () => {
      s.memory.state.pending = pending;
    };
    expect(await s.run((p) => p.save(saveLink))).toEqual({
      status: "rejected",
      reason: "stale-context",
    });
    expect(s.records).toHaveLength(0);
  });

  test("a stale rendered context never changes consent", async () => {
    const s = scenario();
    expect(
      await s.run((p) => p.save({ ...saveAccount, context: "stale" }))
    ).toEqual({ status: "rejected", reason: "stale-context" });
    expect(s.records).toHaveLength(0);
  });

  test("dependency failures remain unavailable and do not become actionable refusals", async () => {
    const s = scenario();
    s.state.ledgerUnavailable = true;
    await expectUnavailable(
      s.run((p) => p.save(saveAccount).pipe(Effect.result))
    );
    expect(s.records).toHaveLength(0);
    s.memory.state.session = session;
    s.state.sessionUnavailable = true;
    expect(await s.run((p) => p.read)).toEqual({ status: "unavailable" });
    expect(s.state.accountReads).toBe(2);
  });
});

describe("MarketingPreferences confirmation and dismissal", () => {
  test("confirmation and dismissal need neither account nor ledger configuration", async () => {
    const memory = makeMemoryMarketingCookies({ pending, session: undefined });
    const layer = MarketingPreferences.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          memory.layer,
          Layer.mock(MarketingManagementService, {
            exchange: () =>
              Effect.succeed({ token: session, expiresAt: expiry }),
            revoke: () => Effect.void,
          })
        )
      )
    );
    const run = <A, E>(
      use: (preferences: MarketingPreferences["Service"]) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.flatMap(MarketingPreferences, use).pipe(Effect.provide(layer))
      );
    expect(await run((p) => p.confirm(confirm))).toEqual({
      status: "confirmed",
    });
    expect(
      await run((p) =>
        p.clear({
          context: getMarketingManagementDismissalContext(memory.state),
        })
      )
    ).toEqual({ status: "cleared" });
    expect(memory.state.session).toBeUndefined();
  });

  test("confirmation without pending fails closed even with a signed-in account", async () => {
    const s = scenario();
    await expectUnavailable(
      s.run((p) => p.confirm(confirm).pipe(Effect.result))
    );
    expect(s.state.accountReads).toBe(0);
    expect(s.state.exchanges).toBe(0);
    expect(s.memory.state.session).toBeUndefined();
  });

  test("exchanges once, installs a session, and refuses replay without installing another", async () => {
    const s = scenario();
    s.memory.state.pending = pending;
    expect(await s.run((p) => p.confirm(confirm))).toEqual({
      status: "confirmed",
    });
    expect(s.memory.state.pending).toBeUndefined();
    expect((await s.run((p) => p.read)).status).toBe("absent");
    s.memory.state.pending = pending;
    expect(await s.run((p) => p.confirm(confirm))).toEqual({
      status: "rejected",
      reason: "invalid-link",
    });
    expect(s.memory.state.pending).toBe(pending);
  });

  test("changed pending state before exchange fences token consumption", async () => {
    const s = scenario();
    s.memory.state.pending = pending;
    let reads = 0;
    const changingCookies = {
      ...s.memory.cookies,
      read: s.memory.cookies.read.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (++reads === 1) s.memory.state.pending = "different-pending";
          })
        )
      ),
    };
    const outcome = await Effect.runPromise(
      Effect.flatMap(MarketingPreferences, (p) => p.confirm(confirm)).pipe(
        Effect.provide(
          MarketingPreferences.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                s.dependencies,
                Layer.succeed(MarketingManagementCookies, changingCookies)
              )
            )
          )
        )
      )
    );
    expect(outcome).toEqual({ status: "rejected", reason: "stale-context" });
    expect(s.state.exchanges).toBe(0);
  });

  test("changed pending state during exchange prevents installing its session", async () => {
    const s = scenario();
    s.memory.state.pending = pending;
    s.state.onExchange = () => {
      s.memory.state.pending = undefined;
    };
    expect(await s.run((p) => p.confirm(confirm))).toEqual({
      status: "rejected",
      reason: "stale-context",
    });
    expect(s.memory.state.session).toBeUndefined();
  });

  test("forbidden cookie writes fail safely and replay stays refused", async () => {
    const s = scenario();
    s.memory.state.pending = pending;
    s.memory.state.writable = false;
    await expectUnavailable(
      s.run((p) => p.confirm(confirm).pipe(Effect.result))
    );
    expect(s.memory.state.session).toBeUndefined();
    s.memory.state.writable = true;
    expect(await s.run((p) => p.confirm(confirm))).toEqual({
      status: "rejected",
      reason: "invalid-link",
    });
  });

  test("revokes the active session even alongside pending, then clears both", async () => {
    const s = scenario();
    s.memory.state.pending = pending;
    s.memory.state.session = session;
    const input = {
      context: getMarketingManagementDismissalContext(s.memory.state),
    };
    expect(await s.run((p) => p.clear(input))).toEqual({ status: "cleared" });
    expect(s.sessions.has(session)).toBe(false);
    expect(s.memory.state.pending).toBeUndefined();
    expect(s.memory.state.session).toBeUndefined();
    expect(s.state.accountReads).toBe(0);
  });

  test("retries cookie clearing after revocation succeeded on a read-only attempt", async () => {
    const s = scenario();
    s.memory.state.session = session;
    s.memory.state.writable = false;
    const input = {
      context: getMarketingManagementDismissalContext(s.memory.state),
    };
    await expectUnavailable(s.run((p) => p.clear(input).pipe(Effect.result)));
    expect(s.sessions.has(session)).toBe(false);
    expect(s.memory.state.session).toBe(session);
    s.memory.state.writable = true;
    expect(await s.run((p) => p.clear(input))).toEqual({ status: "cleared" });
    expect(s.memory.state.session).toBeUndefined();
  });

  test("failed revocation preserves cookies for a later attempt", async () => {
    const s = scenario();
    s.memory.state.session = session;
    s.state.revokeUnavailable = true;
    await expectUnavailable(
      s.run((p) =>
        p
          .clear({
            context: getMarketingManagementDismissalContext(s.memory.state),
          })
          .pipe(Effect.result)
      )
    );
    expect(s.sessions.has(session)).toBe(true);
    expect(s.memory.state.session).toBe(session);
  });

  test("changed cookie pair before revocation fences the revoke", async () => {
    const s = scenario();
    s.memory.state.session = session;
    const input = {
      context: getMarketingManagementDismissalContext(s.memory.state),
    };
    let reads = 0;
    const changingCookies = {
      ...s.memory.cookies,
      read: s.memory.cookies.read.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (++reads === 1) s.memory.state.pending = pending;
          })
        )
      ),
    };
    const outcome = await Effect.runPromise(
      Effect.flatMap(MarketingPreferences, (p) => p.clear(input)).pipe(
        Effect.provide(
          MarketingPreferences.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                s.dependencies,
                Layer.succeed(MarketingManagementCookies, changingCookies)
              )
            )
          )
        )
      )
    );
    expect(outcome).toEqual({ status: "rejected", reason: "stale-context" });
    expect(s.state.revokes).toBe(0);
    expect(s.memory.state.pending).toBe(pending);
  });

  test("changed cookie pair during revocation is preserved", async () => {
    const s = scenario();
    s.memory.state.session = session;
    s.state.onRevoke = () => {
      s.memory.state.pending = pending;
    };
    expect(
      await s.run((p) =>
        p.clear({
          context: getMarketingManagementDismissalContext(s.memory.state),
        })
      )
    ).toEqual({ status: "rejected", reason: "stale-context" });
    expect(s.memory.state.pending).toBe(pending);
    expect(s.memory.state.session).toBe(session);
  });

  test("stale dismissal cannot revoke or clear, pending-only dismissal needs no identity", async () => {
    const s = scenario();
    s.memory.state.pending = pending;
    expect(await s.run((p) => p.clear({ context: "stale" }))).toEqual({
      status: "rejected",
      reason: "stale-context",
    });
    expect(s.memory.state.pending).toBe(pending);
    expect(
      await s.run((p) =>
        p.clear({
          context: getMarketingManagementDismissalContext(s.memory.state),
        })
      )
    ).toEqual({ status: "cleared" });
    expect(s.state.revokes).toBe(0);
    expect(s.state.accountReads).toBe(0);
  });
});
