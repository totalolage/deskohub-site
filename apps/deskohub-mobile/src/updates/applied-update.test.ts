import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import {
  DeviceCapabilityFailed,
  DeviceStorage,
} from "../customer-api/device-capabilities";
import {
  type AppliedUpdate,
  lastLaunchedUpdateKey,
  type RunningUpdate,
  recordAppliedUpdate,
} from "./applied-update";

/** AsyncStorage as a map that outlives each launch, like the device's. */
const makeStorage = () => {
  const values = new Map<string, string>();
  let failing: "read" | "write" | undefined;
  const failed = () =>
    Effect.fail(new DeviceCapabilityFailed({ capability: "storage" }));
  const layer = Layer.succeed(DeviceStorage, {
    getItem: (key) =>
      failing === "read"
        ? failed()
        : Effect.sync(() => Option.fromNullishOr(values.get(key))),
    setItem: (key, value) =>
      failing === "write"
        ? failed()
        : Effect.sync(() => {
            values.set(key, value);
          }),
    removeItems: (keys) =>
      Effect.sync(() => {
        for (const key of keys) values.delete(key);
      }),
    keys: Effect.sync(() => [...values.keys()]),
  });
  return {
    values,
    layer,
    fail: (operation: "read" | "write" | undefined) => {
      failing = operation;
    },
  };
};

const embedded: RunningUpdate = {
  updateId: "embedded-1",
  runtimeVersion: "runtime-a",
  isEmbeddedLaunch: true,
};
const downloaded = (updateId: string): RunningUpdate => ({
  updateId,
  runtimeVersion: "runtime-a",
  isEmbeddedLaunch: false,
});

/** Launches the app on `running` and answers what it recorded. */
const launch = async (
  storage: ReturnType<typeof makeStorage>,
  running: RunningUpdate
) => {
  const recorded: AppliedUpdate[] = [];
  await Effect.runPromise(
    recordAppliedUpdate(running, (update) => recorded.push(update)).pipe(
      Effect.provide(storage.layer)
    )
  );
  return recorded;
};

describe("applied update", () => {
  test("records the first launch on a downloaded update with its runtime", async () => {
    const storage = makeStorage();
    expect(await launch(storage, embedded)).toEqual([]);

    expect(await launch(storage, downloaded("update-2"))).toEqual([
      { updateId: "update-2", runtimeVersion: "runtime-a" },
    ]);
    expect(storage.values.get(lastLaunchedUpdateKey)).toBe("update-2");
  });

  test("records the update once however many launches run it", async () => {
    const storage = makeStorage();
    await launch(storage, embedded);
    await launch(storage, downloaded("update-2"));

    expect(await launch(storage, downloaded("update-2"))).toEqual([]);
    expect(await launch(storage, downloaded("update-3"))).toEqual([
      { updateId: "update-3", runtimeVersion: "runtime-a" },
    ]);
  });

  test("records the update that brought this check on an app that never stored a launch", async () => {
    const storage = makeStorage();

    expect(await launch(storage, downloaded("update-2"))).toEqual([
      { updateId: "update-2", runtimeVersion: "runtime-a" },
    ]);
  });

  test("records no rollback or other embedded launch, and records an update applied again after it", async () => {
    const storage = makeStorage();
    await launch(storage, downloaded("update-2"));

    expect(await launch(storage, embedded)).toEqual([]);
    expect(await launch(storage, downloaded("update-2"))).toEqual([
      { updateId: "update-2", runtimeVersion: "runtime-a" },
    ]);
  });

  test("leaves out a runtime version the build doesn't know", async () => {
    const storage = makeStorage();

    expect(
      await launch(storage, { ...downloaded("update-2"), runtimeVersion: null })
    ).toEqual([{ updateId: "update-2" }]);
  });

  test("records nothing where updates are disabled", async () => {
    const storage = makeStorage();

    expect(
      await launch(storage, {
        updateId: null,
        runtimeVersion: null,
        isEmbeddedLaunch: false,
      })
    ).toEqual([]);
    expect(storage.values.size).toBe(0);
  });

  test("records nothing it couldn't store, so a later launch can't record it twice", async () => {
    const storage = makeStorage();
    await launch(storage, embedded);

    storage.fail("read");
    expect(await launch(storage, downloaded("update-2"))).toEqual([]);
    storage.fail("write");
    expect(await launch(storage, downloaded("update-2"))).toEqual([]);

    storage.fail(undefined);
    expect(await launch(storage, downloaded("update-2"))).toEqual([
      { updateId: "update-2", runtimeVersion: "runtime-a" },
    ]);
  });
});
