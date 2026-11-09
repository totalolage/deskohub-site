import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { loadPostHogSdk } from "./posthog-sdk-load";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("loadPostHogSdk", () => {
  test("hands the loaded SDK over without retrying", async () => {
    const onLoad = mock((_sdk: string) => undefined);
    const retry = mock(() => undefined);

    const stop = loadPostHogSdk({
      load: () => Promise.resolve("sdk"),
      onLoad,
      retry,
    });
    await settle();
    window.dispatchEvent(new Event("focus"));

    expect(onLoad.mock.calls).toEqual([["sdk"]]);
    expect(retry).not.toHaveBeenCalled();
    stop();
  });

  test.each(["focus", "online"])(
    "retries a failed load on the next %s event",
    async (eventName) => {
      const onLoad = mock(() => undefined);
      const retry = mock(() => undefined);

      const stop = loadPostHogSdk({
        load: () => Promise.reject(new Error("synthetic chunk load failure")),
        onLoad,
        retry,
      });
      await settle();
      window.dispatchEvent(new Event(eventName));

      expect(retry).toHaveBeenCalledTimes(1);
      expect(onLoad).not.toHaveBeenCalled();

      stop();
      window.dispatchEvent(new Event(eventName));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  );

  test("ignores a load that settles after cleanup", async () => {
    const loaded = Promise.withResolvers<string>();
    const failed = Promise.withResolvers<string>();
    const onLoad = mock((_sdk: string) => undefined);
    const retry = mock(() => undefined);

    loadPostHogSdk({ load: () => loaded.promise, onLoad, retry })();
    loadPostHogSdk({ load: () => failed.promise, onLoad, retry })();
    loaded.resolve("sdk");
    failed.reject(new Error("synthetic chunk load failure"));
    await settle();
    window.dispatchEvent(new Event("focus"));

    expect(onLoad).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });
});
