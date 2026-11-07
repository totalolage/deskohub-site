import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  AccountExitFence,
  accountStorageKey,
  makeAccountExitFence,
} from "./account-scoped-storage";
import {
  type AccountExit,
  type AccountPresence,
  accountExitOf,
  customerDataExitCleanup,
} from "./exit-cleanup";
import {
  fakeDeviceCapabilities,
  makeFakeDevice,
} from "./testing/fake-customer-data";

const restoring: AccountPresence = { status: "restoring" };
const signedOut: AccountPresence = { status: "signed-out" };
const accountA: AccountPresence = { status: "signed-in", accountId: "a" };
const accountB: AccountPresence = { status: "signed-in", accountId: "b" };
const exitOfA: AccountExit = { scope: "account", accountId: "a" };

describe("accountExitOf", () => {
  // biome-ignore format: the case table stays one row per line on purpose.
  const cases: ReadonlyArray<readonly [string, AccountPresence, AccountPresence, AccountExit | undefined]> = [
    ["sign-out", accountA, signedOut, exitOfA],
    ["account switch", accountA, accountB, exitOfA],
    ["a launch that finds no session", restoring, signedOut, { scope: "device" }],
    ["a launch that restores a session", restoring, accountA, undefined],
    ["a session refetch for the same account", accountA, accountA, undefined],
    ["signing in after being signed out", signedOut, accountA, undefined],
    ["staying signed out", signedOut, signedOut, undefined],
    ["a restore in progress", accountA, restoring, undefined],
  ];

  test.each(cases)("%s", (_title, previous, next, exit) => {
    expect(accountExitOf(previous, next)).toEqual(exit);
  });
});

const origin = "https://x.example";
const keyOf = (name: string, accountId: string) =>
  accountStorageKey(name, { apiOrigin: origin, accountId });

const seededDevice = () => {
  const device = makeFakeDevice();
  device.storage.set(keyOf("deskohub.reservations.v1", "a"), "{}");
  device.storage.set(keyOf("deskohub.booking.referral.v1", "a"), "CODE");
  device.storage.set(keyOf("deskohub.reservations.v1", "b"), "{}");
  device.storage.set("posthog.distinct_id", "keep");
  device.storage.set("deskohub.analytics-consent", "keep");
  device.files.set(
    "file:///cache/deskohub-share/a/invoice.pdf",
    new Uint8Array()
  );
  device.files.set(
    "file:///cache/deskohub-share/b/invoice.pdf",
    new Uint8Array()
  );
  return device;
};

const cleanUp = (
  device: ReturnType<typeof makeFakeDevice>,
  exit: AccountExit
) =>
  Effect.runPromise(
    customerDataExitCleanup(exit).pipe(
      Effect.provide(
        Layer.merge(
          fakeDeviceCapabilities(device),
          Layer.sync(AccountExitFence, makeAccountExitFence)
        )
      )
    )
  );

describe("customerDataExitCleanup", () => {
  test("removes the exiting account's entries and files, keeping another account's and the app's", async () => {
    const device = seededDevice();

    await cleanUp(device, exitOfA);

    expect([...device.storage.keys()].sort()).toEqual(
      [
        "deskohub.analytics-consent",
        keyOf("deskohub.reservations.v1", "b"),
        "posthog.distinct_id",
      ].sort()
    );
    expect([...device.files.keys()]).toEqual([
      "file:///cache/deskohub-share/b/invoice.pdf",
    ]);
  });

  test("a launch without a session clears every account's entries and files", async () => {
    const device = seededDevice();

    await cleanUp(device, { scope: "device" });

    expect([...device.storage.keys()].sort()).toEqual([
      "deskohub.analytics-consent",
      "posthog.distinct_id",
    ]);
    expect(device.files.size).toBe(0);
  });
});
