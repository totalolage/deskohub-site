import {
  type DotyposCategory,
  DotyposCategorySchema,
  type DotyposProduct,
  DotyposProductSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { getCache, waitUntil } from "@vercel/functions";
import { Context, Effect, Layer, Schema } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import type { MobileShopCatalogMappingPolicy } from "../catalog";
import { MobileShopFailure } from "../errors";

export interface MobileShopCatalogSourceSnapshot {
  /** Complete paginated provider result, not a first-page approximation. */
  readonly categories: readonly DotyposCategory[];
  readonly products: readonly DotyposProduct[];
  /** Provider snapshot time when known; cached browsing must preserve it. */
  readonly generatedAt?: Temporal.Instant;
}

export interface IMobileShopCatalogSource {
  readonly loadAll: Effect.Effect<
    MobileShopCatalogSourceSnapshot,
    MobileShopFailure
  >;
}

interface MobileShopCatalogCache {
  readonly get: (key: string) => Promise<unknown | null>;
  readonly set: (
    key: string,
    value: unknown,
    options?: {
      readonly name?: string;
      readonly ttl?: number;
    }
  ) => Promise<void>;
}

const browseCatalogCacheNamespace = "mobile-shop-browse-catalog-v1";
const browseCatalogCacheKey = "dotypos-source";
const browseCatalogFreshMs = 15 * 60 * 1_000;
const browseCatalogRetentionSeconds = 30 * 60;
const cachedCatalogSnapshotSchema = Schema.Struct({
  generatedAt: instantStringSchema,
  categories: Schema.Array(DotyposCategorySchema),
  products: Schema.Array(DotyposProductSchema),
});

let activeBrowseCatalogRefresh:
  | Promise<MobileShopCatalogSourceSnapshot>
  | undefined;

const beginBrowseCatalogRefresh = (
  loadFresh: Effect.Effect<MobileShopCatalogSourceSnapshot, MobileShopFailure>
) => {
  if (activeBrowseCatalogRefresh) {
    return { started: false, task: activeBrowseCatalogRefresh } as const;
  }

  const task = loadFresh.pipe(
    runWorkspaceEffect("mobile-shop.catalog.refresh", { boundary: "task" })
  );
  activeBrowseCatalogRefresh = task;
  const clear = () => {
    if (activeBrowseCatalogRefresh === task) {
      activeBrowseCatalogRefresh = undefined;
    }
  };
  void task.then(clear, clear);
  return { started: true, task } as const;
};

export const createMobileShopBrowseCatalogSource = (input: {
  readonly source: IMobileShopCatalogSource;
  readonly cache: MobileShopCatalogCache;
  readonly now?: () => number;
  readonly schedule?: (task: Promise<unknown>) => void;
}): IMobileShopCatalogSource => {
  const now = input.now ?? Date.now;
  const schedule =
    input.schedule ??
    ((task) => {
      waitUntil(task);
    });

  const readCached = Effect.tryPromise(() =>
    input.cache.get(browseCatalogCacheKey)
  ).pipe(
    Effect.flatMap((value) =>
      value === null
        ? Effect.succeed(null)
        : Schema.decodeUnknownEffect(cachedCatalogSnapshotSchema)(value).pipe(
            Effect.orElseSucceed(() => null)
          )
    ),
    Effect.orElseSucceed(() => null)
  );

  const loadFresh = input.source.loadAll.pipe(
    Effect.map((snapshot) => ({
      ...snapshot,
      generatedAt: Temporal.Instant.fromEpochMilliseconds(now()),
    })),
    Effect.tap((snapshot) =>
      Effect.tryPromise(() =>
        input.cache.set(
          browseCatalogCacheKey,
          { ...snapshot, generatedAt: snapshot.generatedAt.toString() },
          {
            name: "Dotypos mobile shop catalog",
            ttl: browseCatalogRetentionSeconds,
          }
        )
      ).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Mobile shop catalog cache write failed", {
            cause,
          })
        ),
        Effect.ignore
      )
    )
  );

  const awaitRefresh = Effect.tryPromise({
    try: () => beginBrowseCatalogRefresh(loadFresh).task,
    catch: (cause) =>
      cause instanceof MobileShopFailure
        ? cause
        : new MobileShopFailure({ code: "catalog_unavailable", cause }),
  });

  return {
    loadAll: Effect.gen(function* () {
      const cached = yield* readCached;
      if (!cached) return yield* awaitRefresh;

      const snapshot = {
        categories: cached.categories,
        products: cached.products,
        generatedAt: Temporal.Instant.from(cached.generatedAt),
      } satisfies MobileShopCatalogSourceSnapshot;
      if (
        now() - snapshot.generatedAt.epochMilliseconds <=
        browseCatalogFreshMs
      ) {
        return snapshot;
      }

      yield* Effect.sync(() => {
        const refresh = beginBrowseCatalogRefresh(loadFresh);
        if (refresh.started) schedule(refresh.task.catch(() => undefined));
      });
      return snapshot;
    }),
  };
};

export class MobileShopBrowseCatalogSource extends Context.Service<
  MobileShopBrowseCatalogSource,
  IMobileShopCatalogSource
>()("@deskohub-workspace/mobile-shop/MobileShopBrowseCatalogSource") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const source = yield* MobileShopCatalogSource;
      return createMobileShopBrowseCatalogSource({
        source,
        cache: getCache({ namespace: browseCatalogCacheNamespace }),
      });
    })
  );
}

export class MobileShopCatalogSource extends Context.Service<
  MobileShopCatalogSource,
  IMobileShopCatalogSource
>()("@deskohub-workspace/mobile-shop/MobileShopCatalogSource") {
  static Unavailable = Layer.succeed(this, {
    loadAll: MobileShopFailure.integrationUnavailable(
      "Dotypos paginated catalog operations have not been installed."
    ),
  });

  static Dotypos = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      return {
        loadAll: Effect.all(
          {
            categories: dotypos.getCategories(),
            products: dotypos.getProducts({ includeDeleted: true }),
          },
          { concurrency: "inherit" }
        ).pipe(
          Effect.mapError(
            (cause) =>
              new MobileShopFailure({ code: "catalog_unavailable", cause })
          )
        ),
      } satisfies IMobileShopCatalogSource;
    })
  );
}

export interface IMobileShopCatalogPolicy {
  readonly current: Effect.Effect<
    MobileShopCatalogMappingPolicy,
    MobileShopFailure
  >;
}

export class MobileShopCatalogPolicy extends Context.Service<
  MobileShopCatalogPolicy,
  IMobileShopCatalogPolicy
>()("@deskohub-workspace/mobile-shop/MobileShopCatalogPolicy") {
  static Unavailable = Layer.succeed(this, {
    current: MobileShopFailure.integrationUnavailable(
      "The verified Dotypos final-price mapping has not been installed."
    ),
  });

  static DesktechubNonVat = Layer.succeed(this, {
    current: Effect.sync(
      () =>
        ({
          finalPriceField: "priceWithoutVat",
          taxRegime: {
            kind: "not-vat-payer",
            version: "desktechub-non-vat-2026-08",
            effectiveFrom: Schema.decodeUnknownSync(plainDateStringSchema)(
              "2026-08-11"
            ),
          },
        }) satisfies MobileShopCatalogMappingPolicy
    ),
  });
}
