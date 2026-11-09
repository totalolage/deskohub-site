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
  type FakeDevice,
  fakeDeviceCapabilities,
  makeFakeDevice,
} from "./testing/fake-customer-data";

const restoring: AccountPresence = { status: "restoring" };
const signedOut: AccountPresence = { status: "signed-out" };
const sessionA1 = { accountId: "a", sessionStartedAt: 1 };
const sessionA2 = { accountId: "a", sessionStartedAt: 2 };
const sessionB = { accountId: "b", sessionStartedAt: 3 };
const signedInA1: AccountPresence = { status: "signed-in", ...sessionA1 };
const signedInA2: AccountPresence = { status: "signed-in", ...sessionA2 };
const signedInB: AccountPresence = { status: "signed-in", ...sessionB };
const exitOfA1: AccountExit = { scope: "account", ...sessionA1 };

describe("accountExitOf", () => {
  // biome-ignore format: the case table stays one row per line on purpose.
  const cases: ReadonlyArray<readonly [string, AccountPresence, AccountPresence, AccountExit | undefined]> = [
    ["sign-out", signedInA1, signedOut, exitOfA1],
    ["account switch", signedInA1, signedInB, exitOfA1],
    ["reauthentication of the same account", signedInA1, signedInA2, undefined],
    ["a launch that finds no session", restoring, signedOut, { scope: "device" }],
    ["a launch that restores a session", restoring, signedInA1, { scope: "shared-files" }],
    ["a session refetch", signedInA1, signedInA1, undefined],
    ["signing in after being signed out", signedOut, signedInA1, undefined],
    ["staying signed out", signedOut, signedOut, undefined],
    ["a restore in progress", signedInA1, restoring, undefined],
  ];

  test.each(cases)("%s", (_title, previous, next, exit) => {
    expect(accountExitOf(previous, next)).toEqual(exit);
  });
});

const origin = "https://x.example";
const keyOf = (name: string, accountId: string) =>
  accountStorageKey(name, { apiOrigin: origin, accountId });
const shareFile = (accountId: string) =>
  `file:///cache/deskohub-share/${accountId}/invoice.pdf`;

const seededDevice = () => {
  const device = makeFakeDevice();
  device.storage.set(keyOf("deskohub.reservations.v1", "a"), "{}");
  device.storage.set(keyOf("deskohub.booking.referral.v1", "a"), "CODE");
  device.storage.set(keyOf("deskohub.reservations.v1", "b"), "{}");
  device.storage.set("posthog.distinct_id", "keep");
  device.storage.set("deskohub.analytics-consent", "keep");
  device.files.set(shareFile("a"), new Uint8Array());
  device.files.set(shareFile("b"), new Uint8Array());
  return device;
};

const cleanUp = (
  device: FakeDevice,
  exit: AccountExit,
  fence = makeAccountExitFence()
) =>
  Effect.runPromise(
    customerDataExitCleanup(exit).pipe(
      Effect.provide(
        Layer.merge(
          fakeDeviceCapabilities(device),
          Layer.succeed(AccountExitFence, fence)
        )
      )
    )
  );

const appKeys = ["deskohub.analytics-consent", "posthog.distinct_id"];

describe("customerDataExitCleanup", () => {
  test("removes the exiting account's entries and files, keeping another account's and the app's", async () => {
    const device = seededDevice();

    await cleanUp(device, exitOfA1);

    expect([...device.storage.keys()].sort()).toEqual(
      [...appKeys, keyOf("deskohub.reservations.v1", "b")].sort()
    );
    expect([...device.files.keys()]).toEqual([shareFile("b")]);
  });

  test("a late cleanup keeps the data of the account's newer sign-in", async () => {
    const device = seededDevice();
    const fence = makeAccountExitFence();
    // A signed out and in again before the first exit's cleanup ran.
    await Effect.runPromise(fence.open(sessionA2));

    await cleanUp(device, exitOfA1, fence);

    expect(device.storage.has(keyOf("deskohub.reservations.v1", "a"))).toBe(
      true
    );
    expect(device.files.has(shareFile("a"))).toBe(true);
    expect(Effect.runSync(fence.isCurrent(sessionA2))).toBe(true);
  });

  test("closes the exiting session, so it can't write afterwards", async () => {
    const fence = makeAccountExitFence();
    await Effect.runPromise(fence.open(sessionA1));

    await cleanUp(makeFakeDevice(), exitOfA1, fence);

    expect(Effect.runSync(fence.isCurrent(sessionA1))).toBe(false);
  });

  test("a launch without a session clears every account's entries and files", async () => {
    const device = seededDevice();

    await cleanUp(device, { scope: "device" });

    expect([...device.storage.keys()].sort()).toEqual(appKeys);
    expect(device.files.size).toBe(0);
  });

  test("a device cleanup spares the entries of an account that has signed in meanwhile", async () => {
    const device = seededDevice();
    const fence = makeAccountExitFence();
    await Effect.runPromise(fence.open(sessionB));

    await cleanUp(device, { scope: "device" }, fence);

    expect([...device.storage.keys()].sort()).toEqual(
      [...appKeys, keyOf("deskohub.reservations.v1", "b")].sort()
    );
    // Files no share holds are leftovers, whoever is signed in.
    expect(device.files.size).toBe(0);
  });

  test("a launch that restores a session removes only the files earlier runs left", async () => {
    const device = seededDevice();
    const keys = [...device.storage.keys()].sort();

    await cleanUp(device, { scope: "shared-files" });

    expect([...device.storage.keys()].sort()).toEqual(keys);
    expect(device.files.size).toBe(0);
  });

  const exits: ReadonlyArray<readonly [string, AccountExit]> = [
    ["an account exit", exitOfA1],
    ["a launch without a session", { scope: "device" }],
    ["a launch that restores a session", { scope: "shared-files" }],
  ];

  test.each(exits)(
    "%s keeps the files while a share holds one, until its release",
    async (_title, exit) => {
      const device = seededDevice();
      const fence = makeAccountExitFence();
      await Effect.runPromise(fence.open(sessionA1));
      await Effect.runPromise(fence.holdFile(shareFile("a")));

      await cleanUp(device, exit, fence);

      expect(device.files.has(shareFile("a"))).toBe(true);
      expect(Effect.runSync(fence.releaseFile(shareFile("a")))).toBe(true);
    }
  );
});
