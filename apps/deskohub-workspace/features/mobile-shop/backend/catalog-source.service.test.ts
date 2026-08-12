import { describe, expect, mock, test } from "bun:test";
import { type DotyposCategory, DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  createMobileShopBrowseCatalogSource,
  MobileShopCatalogPolicy,
  MobileShopCatalogSource,
} from "./catalog-source.service";

describe("mobile shop catalog source", () => {
  test("loads the complete Dotypos category and product catalog", async () => {
    const getCategories = mock(() => Effect.succeed([]));
    const getProducts = mock(() => Effect.succeed([]));
    const snapshot = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* MobileShopCatalogSource;
        return yield* source.loadAll;
      }).pipe(
        Effect.provide(
          MobileShopCatalogSource.Dotypos.pipe(
            Layer.provide(
              Layer.mock(DotyposService, { getCategories, getProducts })
            )
          )
        )
      )
    );

    expect(snapshot).toEqual({ categories: [], products: [] });
    expect(getCategories).toHaveBeenCalledTimes(1);
    expect(getProducts).toHaveBeenCalledTimes(1);
    expect(getProducts).toHaveBeenCalledWith({ includeDeleted: true });
  });

  test("shares a fresh catalog snapshot without repeating Dotypos reads", async () => {
    let reads = 0;
    const values = new Map<string, unknown>();
    const browse = createMobileShopBrowseCatalogSource({
      source: {
        loadAll: Effect.sync(() => {
          reads += 1;
          return {
            categories: [{ name: `Catalog ${reads}` } as DotyposCategory],
            products: [],
          };
        }),
      },
      cache: {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value);
        },
      },
      now: () => 1_000,
      schedule: () => undefined,
    });

    await Effect.runPromise(browse.loadAll);
    await Effect.runPromise(browse.loadAll);

    expect(reads).toBe(1);
  });

  test("coalesces concurrent cold catalog reads", async () => {
    let reads = 0;
    let releaseLoad = () => undefined;
    let markLoadStarted = () => undefined;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const values = new Map<string, unknown>();
    const browse = createMobileShopBrowseCatalogSource({
      source: {
        loadAll: Effect.promise(async () => {
          reads += 1;
          markLoadStarted();
          await loadGate;
          return {
            categories: [{ name: `Catalog ${reads}` } as DotyposCategory],
            products: [],
          };
        }),
      },
      cache: {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value);
        },
      },
      now: () => 1_000,
      schedule: () => undefined,
    });

    const snapshots = Effect.runPromise(
      Effect.all([browse.loadAll, browse.loadAll], {
        concurrency: "unbounded",
      })
    );
    await loadStarted;
    await Effect.runPromise(Effect.sleep("10 millis"));
    releaseLoad();

    const [first, second] = await snapshots;
    expect(reads).toBe(1);
    expect(first.categories[0]?.name).toBe("Catalog 1");
    expect(second.categories[0]?.name).toBe("Catalog 1");
  });

  test("coalesces concurrent stale catalog refreshes", async () => {
    let reads = 0;
    let now = 1_000;
    let releaseRefresh = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const scheduled: Promise<unknown>[] = [];
    const values = new Map<string, unknown>();
    const browse = createMobileShopBrowseCatalogSource({
      source: {
        loadAll: Effect.promise(async () => {
          reads += 1;
          if (reads > 1) await refreshGate;
          return {
            categories: [{ name: `Catalog ${reads}` } as DotyposCategory],
            products: [],
          };
        }),
      },
      cache: {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value);
        },
      },
      now: () => now,
      schedule: (task) => scheduled.push(task),
    });

    await Effect.runPromise(browse.loadAll);
    now += 15 * 60 * 1_000 + 1;
    const [first, second] = await Effect.runPromise(
      Effect.all([browse.loadAll, browse.loadAll], {
        concurrency: "unbounded",
      })
    );

    expect(first.categories[0]?.name).toBe("Catalog 1");
    expect(second.categories[0]?.name).toBe("Catalog 1");
    expect(scheduled).toHaveLength(1);
    releaseRefresh();
    await Promise.all(scheduled);
    expect(reads).toBe(2);
  });
});

describe("mobile shop catalog policy", () => {
  test("pins Desktechub's verified non-VAT Dotypos price mapping", async () => {
    const policy = await Effect.runPromise(
      Effect.gen(function* () {
        const catalogPolicy = yield* MobileShopCatalogPolicy;
        return yield* catalogPolicy.current;
      }).pipe(Effect.provide(MobileShopCatalogPolicy.DesktechubNonVat))
    );

    expect(policy).toEqual({
      finalPriceField: "priceWithoutVat",
      taxRegime: {
        kind: "not-vat-payer",
        version: "desktechub-non-vat-2026-08",
        effectiveFrom: "2026-08-11",
      },
    });
  });
});
