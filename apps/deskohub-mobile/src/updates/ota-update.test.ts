import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { findReadyUpdate, type OtaUpdateSource } from "./ota-update";

type CheckResult = Awaited<ReturnType<OtaUpdateSource["checkForUpdateAsync"]>>;
type FetchResult = Awaited<ReturnType<OtaUpdateSource["fetchUpdateAsync"]>>;

const available = {
  isAvailable: true,
  isRollBackToEmbedded: false,
  manifest: { id: "update-a" },
  reason: undefined,
} as unknown as CheckResult;

const unavailable = {
  isAvailable: false,
  isRollBackToEmbedded: false,
  manifest: undefined,
  reason: "noUpdateAvailableOnServer",
} as unknown as CheckResult;

const fetchedNew = {
  isNew: true,
  isRollBackToEmbedded: false,
  manifest: { id: "update-a" },
} as unknown as FetchResult;

const rollBack = {
  isAvailable: false,
  isRollBackToEmbedded: true,
  manifest: undefined,
  reason: undefined,
} as unknown as CheckResult;

const fetchedRollBack = {
  isNew: false,
  isRollBackToEmbedded: true,
  manifest: undefined,
} as unknown as FetchResult;

const fetchedNothingNew = {
  isNew: false,
  isRollBackToEmbedded: false,
  manifest: undefined,
} as unknown as FetchResult;

const source = (
  check: () => Promise<CheckResult>,
  fetch: () => Promise<FetchResult>
) => {
  const calls = { check: 0, fetch: 0 };
  const updates: OtaUpdateSource = {
    checkForUpdateAsync: () => {
      calls.check += 1;
      return check();
    },
    fetchUpdateAsync: () => {
      calls.fetch += 1;
      return fetch();
    },
  };
  return { calls, updates };
};

describe("findReadyUpdate", () => {
  test("downloads an available update and reports it ready", async () => {
    const { calls, updates } = source(
      async () => available,
      async () => fetchedNew
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toEqual({
      kind: "update",
      updateId: "update-a",
    });
    expect(calls).toEqual({ check: 1, fetch: 1 });
  });

  test("fetches a rollback directive and reports the embedded update ready", async () => {
    const { calls, updates } = source(
      async () => rollBack,
      async () => fetchedRollBack
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toEqual({
      kind: "embedded",
    });
    expect(calls).toEqual({ check: 1, fetch: 1 });
  });

  test("reports nothing when the rollback fetch brings nothing to apply", async () => {
    const { calls, updates } = source(
      async () => rollBack,
      async () => fetchedNothingNew
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toBeUndefined();
    expect(calls).toEqual({ check: 1, fetch: 1 });
  });

  // The server may publish between the check and the fetch, so the fetch
  // result decides what is ready.
  test("reports the rollback a download brought after the check found an update", async () => {
    const { updates } = source(
      async () => available,
      async () => fetchedRollBack
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toEqual({
      kind: "embedded",
    });
  });

  test("reports the update a download brought after the check found a rollback", async () => {
    const { updates } = source(
      async () => rollBack,
      async () => fetchedNew
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toEqual({
      kind: "update",
      updateId: "update-a",
    });
  });

  test("swallows a failed rollback fetch", async () => {
    const { updates } = source(
      async () => rollBack,
      () => Promise.reject(new Error("signature rejected"))
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toBeUndefined();
  });

  test("downloads nothing when the server has no update", async () => {
    const { calls, updates } = source(
      async () => unavailable,
      async () => fetchedNew
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toBeUndefined();
    expect(calls).toEqual({ check: 1, fetch: 0 });
  });

  test("reports nothing when the download brings nothing new", async () => {
    const { updates } = source(
      async () => available,
      async () => fetchedNothingNew
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toBeUndefined();
  });

  test("swallows a failed check", async () => {
    const { calls, updates } = source(
      () => Promise.reject(new Error("offline")),
      async () => fetchedNew
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toBeUndefined();
    expect(calls.fetch).toBe(0);
  });

  test("swallows a check that throws before returning a promise", async () => {
    const { updates } = source(
      () => {
        throw new Error("updates disabled");
      },
      async () => fetchedNew
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toBeUndefined();
  });

  test("swallows a failed download", async () => {
    const { updates } = source(
      async () => available,
      () => Promise.reject(new Error("signature rejected"))
    );
    expect(await Effect.runPromise(findReadyUpdate(updates))).toBeUndefined();
  });
});
