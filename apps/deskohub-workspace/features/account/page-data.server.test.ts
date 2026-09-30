import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import type { CustomerAccountId } from "@/features/account/customer-account";

let currentUserEffect: Effect.Effect<
  {
    readonly accountId: CustomerAccountId;
    readonly email: string;
    readonly deletionRequested: boolean;
  } | null,
  unknown
>;

const Authentication = Context.Service<
  Authentication,
  {
    readonly currentUser: typeof currentUserEffect;
  }
>()("@test/AccountAuthentication");

const AuthenticationLayer = Layer.effect(
  Authentication,
  Effect.succeed({
    get currentUser() {
      return currentUserEffect;
    },
  })
);
Object.assign(Authentication, {
  Default: AuthenticationLayer,
  Live: AuthenticationLayer,
});

const accountId = "auth-account-1" as CustomerAccountId;
const activeSession = {
  accountId,
  email: "ada@example.test",
  deletionRequested: false,
};

let resolveEffect: Effect.Effect<
  { readonly accountId: CustomerAccountId; readonly dotyposCustomerId: string },
  { readonly reason: string; readonly linkReason?: string }
>;
let resolverCalls = 0;
let profileLoadCalls = 0;
let historyLoadCalls = 0;
let invoiceListCalls = 0;

const Resolver = Context.Service<
  Resolver,
  { readonly resolve: () => typeof resolveEffect }
>()("@test/AccountResolver");

const ResolverLayer = Layer.succeed(Resolver, {
  resolve: () => resolveEffect,
});
Object.assign(Resolver, { Live: ResolverLayer });

const resolverOutcome = (
  outcome:
    | { readonly kind: "success"; readonly customerId: string }
    | {
        readonly kind: "failure";
        readonly reason: string;
        readonly linkReason?: string;
      }
) =>
  outcome.kind === "success"
    ? Effect.succeed({ accountId, dotyposCustomerId: outcome.customerId })
    : Effect.fail({ reason: outcome.reason, linkReason: outcome.linkReason });

const Profile = Context.Service<
  Profile,
  {
    readonly load: () => Effect.Effect<
      {
        readonly firstName: string;
        readonly lastName: string | null;
        readonly phone: string | null;
        readonly billing: null;
      },
      unknown
    >;
  }
>()("@test/AccountProfile");

const profileLoadEffect = Effect.succeed({
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
  billing: null,
});

const ProfileLayer = Layer.succeed(Profile, {
  load: () => {
    profileLoadCalls += 1;
    return profileLoadEffect;
  },
});
Object.assign(Profile, { Live: ProfileLayer });

let historyEffect: Effect.Effect<
  | {
      readonly kind: "available";
      readonly groups: {
        current: unknown[];
        past: unknown[];
        unavailable: unknown[];
      };
    }
  | { readonly kind: "unavailable"; readonly reason: string },
  unknown
>;

const History = Context.Service<
  History,
  { readonly load: () => typeof historyEffect }
>()("@test/AccountReservationHistory");

const HistoryLayer = Layer.succeed(History, {
  load: () => {
    historyLoadCalls += 1;
    return historyEffect;
  },
});
Object.assign(History, { Live: HistoryLayer });

mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({
    CustomerAuthentication: Authentication,
  })
);
mock.module(
  "@/features/account/backend/customer-account-resolver.service",
  () => ({
    resolveCurrentCustomerAccount: Effect.suspend(() => {
      resolverCalls += 1;
      return resolveEffect;
    }),
    CustomerAccountResolver: Resolver,
  })
);
mock.module("@/features/account/backend/customer-profile.service", () => ({
  CustomerProfileService: Profile,
}));
mock.module(
  "@/features/account/backend/customer-reservation-history.service",
  () => ({
    CustomerReservationHistoryService: History,
  })
);
let invoicesEffect: Effect.Effect<
  readonly unknown[],
  { readonly _tag: string }
> = Effect.succeed([]);

const Invoices = Context.Service<
  Invoices,
  { readonly list: typeof invoicesEffect }
>()("@test/AccountInvoices");

const InvoicesLayer = Layer.succeed(Invoices, {
  get list() {
    invoiceListCalls += 1;
    return invoicesEffect;
  },
});
Object.assign(Invoices, { Live: InvoicesLayer });

mock.module("@/features/account/backend/customer-invoice.service", () => ({
  CustomerInvoiceService: Invoices,
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string, _options: { readonly boundary: string }) =>
    (effect: Effect.Effect<unknown, unknown, never>) =>
      Effect.runPromise(effect),
}));

describe("loadCustomerAccountPage", () => {
  beforeEach(() => {
    currentUserEffect = Effect.succeed(activeSession);
    resolveEffect = resolverOutcome({ kind: "success", customerId: "60111" });
    resolverCalls = 0;
    profileLoadCalls = 0;
    historyLoadCalls = 0;
    invoiceListCalls = 0;
    historyEffect = Effect.succeed({
      kind: "available",
      groups: { current: [], past: [], unavailable: [] },
    });
    invoicesEffect = Effect.succeed([]);
  });

  const loadPageState = async () => {
    const { loadCustomerAccountPage } = await import("./page-data.server");
    return loadCustomerAccountPage("en-US");
  };

  test("returns unauthenticated without customer data or downstream work when no session exists", async () => {
    currentUserEffect = Effect.succeed(null);

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(resolverCalls).toBe(0);
    expect(profileLoadCalls).toBe(0);
    expect(historyLoadCalls).toBe(0);
    expect(invoiceListCalls).toBe(0);
  });

  test("returns unauthenticated without customer data when resolution reports no session", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unauthenticated",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "unauthenticated",
    });
    expect(resolverCalls).toBe(1);
    expect(profileLoadCalls).toBe(0);
    expect(historyLoadCalls).toBe(0);
    expect(invoiceListCalls).toBe(0);
  });

  test("renders the unavailable state when the authoritative session read fails", async () => {
    currentUserEffect = Effect.fail(new Error("boom"));

    await expect(loadPageState()).resolves.toEqual({ kind: "unavailable" });
  });

  test("renders the completion state when no Dotypos profile matches", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "not-found",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "completion-required",
      email: "ada@example.test",
    });
    expect(invoiceListCalls).toBe(0);
  });

  test("renders the support state for ambiguous, unusable, claimed, and unverified outcomes", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "ambiguous",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "unusable",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "link-required",
      linkReason: "claimed",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });

    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unverified-email",
    });
    await expect(loadPageState()).resolves.toEqual({
      kind: "support-required",
      email: "ada@example.test",
    });
  });

  test("renders the retryable deletion state when the durable marker is set", async () => {
    currentUserEffect = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "deletion-pending",
      email: "ada@example.test",
    });
    expect(invoiceListCalls).toBe(0);
  });

  test("renders the linked account with profile and grouped history", async () => {
    await expect(loadPageState()).resolves.toMatchObject({
      kind: "linked",
      email: "ada@example.test",
      profile: { firstName: "Ada" },
      history: { kind: "available" },
    });
  });

  test("returns linked page data while invoices are pending", async () => {
    const assertPageReturnsBeforeInvoices = async (
      invoiceRows: readonly unknown[],
      expectedInvoices: CustomerInvoiceListState
    ) => {
      invoiceListCalls = 0;
      let invoiceResolved = false;
      let settleInvoiceRows!: (rows: readonly unknown[]) => void;
      let notifyInvoiceStarted!: () => void;
      const invoiceStarted = new Promise<void>((resolve) => {
        notifyInvoiceStarted = resolve;
      });
      const pendingInvoiceRows = new Promise<readonly unknown[]>((resolve) => {
        settleInvoiceRows = resolve;
      });
      const resolveInvoiceRows = () => {
        invoiceResolved = true;
        settleInvoiceRows(invoiceRows);
      };
      invoicesEffect = Effect.promise(() => {
        notifyInvoiceStarted();
        return pendingInvoiceRows;
      });

      const pagePromise = loadPageState();
      try {
        await invoiceStarted;
        const pageOutcome = await new Promise<
          | {
              readonly kind: "returned";
              readonly state: Awaited<typeof pagePromise>;
            }
          | { readonly kind: "pending" }
        >((resolve) => {
          const timeout = setTimeout(() => resolve({ kind: "pending" }), 500);
          void pagePromise.then((state) => {
            clearTimeout(timeout);
            resolve({ kind: "returned", state });
          });
        });

        if (pageOutcome.kind === "pending") {
          throw new Error("linked account page waited for invoice lookup");
        }
        if (pageOutcome.state.kind !== "linked") {
          throw new Error("expected linked account page state");
        }
        expect(invoiceListCalls).toBe(1);
        expect(invoiceResolved).toBe(false);

        resolveInvoiceRows();
        await expect(pageOutcome.state.invoices).resolves.toEqual(
          expectedInvoices
        );
      } finally {
        resolveInvoiceRows();
        await pagePromise.catch(() => undefined);
      }
    };

    const invoice = {
      id: "invoice-1",
      invoiceNumber: "WS-FV-2026-000042",
      issuedAt: "2026-08-12T12:34:56.789Z",
      total: "450",
      currency: "CZK",
      paymentStatus: "paid",
      dueDate: null,
    };

    await assertPageReturnsBeforeInvoices([invoice], {
      kind: "populated",
      invoices: [invoice],
    });
    await assertPageReturnsBeforeInvoices([], { kind: "empty" });
  });

  test("keeps the profile available and marks history unavailable when the provider fails", async () => {
    historyEffect = Effect.fail(new Error("dotypos down"));

    const state = await loadPageState();
    expect(state).toMatchObject({
      kind: "linked",
      email: "ada@example.test",
      profile: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone: null,
        billing: null,
      },
      history: { kind: "unavailable", reason: "provider-unavailable" },
    });
    if (state.kind !== "linked") throw new Error("expected linked state");
    await expect(state.invoices).resolves.toEqual({ kind: "empty" });
  });

  test("renders the populated invoice list when issued invoices exist", async () => {
    invoicesEffect = Effect.succeed([
      {
        id: "invoice-1",
        invoiceNumber: "WS-FV-2026-000042",
        issuedAt: "2026-08-12T12:34:56.789Z",
        total: "450",
        currency: "CZK",
        paymentStatus: "paid",
        dueDate: null,
      },
    ]);

    const state = await loadPageState();
    expect(state.kind).toBe("linked");
    if (state.kind !== "linked") throw new Error("expected linked state");
    await expect(state.invoices).resolves.toMatchObject({
      kind: "populated",
    });
  });

  test("degrades to the failed invoice state when the ledger read fails", async () => {
    invoicesEffect = Effect.fail({ _tag: "CustomerInvoicesLoadError" });

    const state = await loadPageState();
    expect(state.kind).toBe("linked");
    if (state.kind !== "linked") throw new Error("expected linked state");
    await expect(state.invoices).resolves.toEqual({ kind: "failed" });
  });

  test("renders the authenticated unavailable state when the profile read fails after a successful link", async () => {
    const failingProfileLayer = Layer.succeed(Profile, {
      load: () => Effect.fail(new Error("profile gone")),
    });
    Object.assign(Profile, { Live: failingProfileLayer });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });
    expect(invoiceListCalls).toBe(0);

    Object.assign(Profile, { Live: ProfileLayer });
  });

  test("renders the authenticated unavailable state for an unexpected resolver failure", async () => {
    resolveEffect = resolverOutcome({
      kind: "failure",
      reason: "unexpected",
    });

    await expect(loadPageState()).resolves.toEqual({
      kind: "authenticated-unavailable",
      email: "ada@example.test",
    });
  });
});
