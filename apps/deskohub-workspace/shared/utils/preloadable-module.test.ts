import { describe, expect, mock, test } from "bun:test";
import { createPreloadableModule } from "./preloadable-module";

describe("createPreloadableModule", () => {
  test("imports once and exposes the loaded module to subscribers", async () => {
    const importModule = mock(() => Promise.resolve({ value: 1 }));
    const preloadable = createPreloadableModule(importModule);
    const listener = mock(() => undefined);
    preloadable.subscribe(listener);

    expect(preloadable.getLoaded()).toBeUndefined();
    preloadable.preload();
    const loaded = await preloadable.load();

    expect(loaded).toEqual({ value: 1 });
    expect(preloadable.getLoaded()).toBe(loaded);
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("retries the import after a failed load", async () => {
    let attempts = 0;
    const preloadable = createPreloadableModule(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("chunk failed"))
        : Promise.resolve({ value: attempts });
    });

    expect(preloadable.load()).rejects.toThrow("chunk failed");
    await Promise.resolve();
    await Promise.resolve();

    expect(await preloadable.load()).toEqual({ value: 2 });
    expect(preloadable.getLoaded()).toEqual({ value: 2 });
  });
});
