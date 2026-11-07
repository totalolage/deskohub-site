import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  AccountExitFence,
  makeAccountExitFence,
} from "./account-scoped-storage";
import {
  type AccountPresence,
  accountExited,
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

describe("accountExited", () => {
  // biome-ignore format: the case table stays one row per line on purpose.
  const cases: ReadonlyArray<readonly [string, AccountPresence, AccountPresence, boolean]> = [
    ["sign-out", accountA, signedOut, true],
    ["account switch", accountA, accountB, true],
    ["a launch that finds no session", restoring, signedOut, true],
    ["a launch that restores a session", restoring, accountA, false],
    ["a session refetch for the same account", accountA, accountA, false],
    ["signing in after being signed out", signedOut, accountA, false],
    ["staying signed out", signedOut, signedOut, false],
    ["a restore in progress", accountA, restoring, false],
  ];

  test.each(cases)("%s", (_title, previous, next, exited) => {
    expect(accountExited(previous, next)).toBe(exited);
  });
});

describe("customerDataExitCleanup", () => {
  test("removes account-scoped storage and temporary files, keeping the rest", async () => {
    const device = makeFakeDevice();
    device.storage.set("deskohub.reservations.v1.https://x.example.a", "{}");
    device.storage.set(
      "deskohub.booking.referral.v1.https://x.example.a",
      "CODE"
    );
    device.storage.set("posthog.distinct_id", "keep");
    device.storage.set("deskohub.analytics-consent", "keep");
    device.files.set(
      "file:///cache/deskohub-share/invoice.pdf",
      new Uint8Array()
    );

    await Effect.runPromise(
      customerDataExitCleanup.pipe(
        Effect.provide(
          Layer.merge(
            fakeDeviceCapabilities(device),
            Layer.sync(AccountExitFence, makeAccountExitFence)
          )
        )
      )
    );

    expect([...device.storage.keys()].sort()).toEqual([
      "deskohub.analytics-consent",
      "posthog.distinct_id",
    ]);
    expect(device.files.size).toBe(0);
  });
});
