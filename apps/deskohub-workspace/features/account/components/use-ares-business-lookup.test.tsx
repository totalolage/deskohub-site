import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { AresBusinessLookupResult } from "@/features/account/actions";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
const { act, cleanup, renderHook } = await import("@testing-library/react");

type LookupOutcome = {
  readonly data?: AresBusinessLookupResult;
  readonly serverError?: string;
};

const foundCompany = {
  companyName: "Registry Company",
  companyId: "27082440",
  city: "Prague",
};

const lookupAresBusiness = mock(
  (_input: { readonly ico: string }): Promise<LookupOutcome> =>
    Promise.resolve({ data: { status: "found", company: foundCompany } })
);

mock.module("@/features/account/actions", () => ({
  acknowledgeSignupReferralNotice: () =>
    Promise.resolve({ data: { status: "acknowledged" } }),
  completeCustomerProfile: () =>
    Promise.resolve({ data: { status: "completed" } }),
  lookupAresBusiness,
  updateCustomerProfile: () => Promise.resolve({ data: { status: "updated" } }),
  updateLocalePreference: () => Promise.resolve({ data: { status: "saved" } }),
}));

const { useAresBusinessLookup } = await import("./use-ares-business-lookup");

const deferLookup = () => {
  let settle!: (outcome: LookupOutcome) => void;
  let fail!: (error: Error) => void;
  lookupAresBusiness.mockImplementationOnce(
    () =>
      new Promise<LookupOutcome>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      })
  );
  return {
    settle: (outcome: LookupOutcome) => settle(outcome),
    fail: (error: Error) => fail(error),
  };
};

const renderLookup = () =>
  renderHook(() => useAresBusinessLookup("en-US")).result;

const lookUp = async (
  lookup: ReturnType<typeof renderLookup>,
  ico = "27082440"
) => {
  await act(async () => {
    lookup.current.lookUp(ico);
  });
};

describe("useAresBusinessLookup", () => {
  afterEach(() => {
    cleanup();
    lookupAresBusiness.mockClear();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("holds a found company for review and applies it once", async () => {
    const lookup = renderLookup();
    await lookUp(lookup);

    expect(lookupAresBusiness.mock.calls[0]?.[0]).toEqual({ ico: "27082440" });
    expect(lookup.current.state).toEqual({
      status: "found",
      review: foundCompany,
    });

    let applied: unknown;
    await act(async () => {
      applied = lookup.current.apply();
    });
    expect(applied).toEqual(foundCompany);
    expect(lookup.current.state).toEqual({
      status: "applied",
      message: m.accountAresLookupApplied({}, { locale: "en-US" }),
    });

    await act(async () => {
      applied = lookup.current.apply();
    });
    expect(applied).toBeUndefined();
  });

  test("reports a resolved lookup outcome with its message", async () => {
    lookupAresBusiness.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: "invalid-ico", message: "Invalid IČO." },
      })
    );
    const lookup = renderLookup();
    await lookUp(lookup, "123");

    expect(lookup.current.state).toEqual({
      status: "invalid-ico",
      message: "Invalid IČO.",
    });
  });

  test("reports server and transport failures as unavailable", async () => {
    const lookup = renderLookup();
    lookupAresBusiness.mockImplementationOnce(() =>
      Promise.resolve({ serverError: "Session expired." })
    );
    await lookUp(lookup);
    expect(lookup.current.state).toEqual({
      status: "unavailable",
      message: "Session expired.",
    });

    lookupAresBusiness.mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );
    await lookUp(lookup);
    expect(lookup.current.state).toEqual({
      status: "unavailable",
      message: m.accountAresLookupActionError({}, { locale: "en-US" }),
    });
  });

  test("ignores a new lookup while one is pending", async () => {
    const pending = deferLookup();
    const lookup = renderLookup();
    await lookUp(lookup);
    expect(lookup.current.isPending).toBe(true);

    await lookUp(lookup, "11111111");
    expect(lookupAresBusiness).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.settle({ data: { status: "found", company: foundCompany } });
    });
    expect(lookup.current.isPending).toBe(false);
  });

  test.each([
    [
      "found response",
      (pending: ReturnType<typeof deferLookup>) =>
        pending.settle({ data: { status: "found", company: foundCompany } }),
    ],
    [
      "server error",
      (pending: ReturnType<typeof deferLookup>) =>
        pending.settle({ serverError: "Session expired." }),
    ],
    [
      "transport error",
      (pending: ReturnType<typeof deferLookup>) =>
        pending.fail(new TypeError("Failed to fetch")),
    ],
  ] as const)(
    "discards a %s that resolves after an invalidating edit",
    async (_outcome, resolveLookup) => {
      const pending = deferLookup();
      const lookup = renderLookup();
      await lookUp(lookup);

      await act(async () => {
        lookup.current.invalidate();
        resolveLookup(pending);
      });

      expect(lookup.current.state).toEqual({ status: "idle" });
      let applied: unknown;
      await act(async () => {
        applied = lookup.current.apply();
      });
      expect(applied).toBeUndefined();

      // A fresh lookup after the edit is current again.
      await lookUp(lookup);
      expect(lookup.current.state).toEqual({
        status: "found",
        review: foundCompany,
      });
    }
  );

  test("invalidating clears a found review", async () => {
    const lookup = renderLookup();
    await lookUp(lookup);

    await act(async () => {
      lookup.current.invalidate();
    });
    expect(lookup.current.state).toEqual({ status: "idle" });
  });
});
