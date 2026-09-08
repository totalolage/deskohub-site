import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "effect";
import type { WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import type { RequestStore } from "next/dist/server/app-render/work-unit-async-storage.external";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  createReservationAccessCookieCapability,
  getReservationAccessCookieName,
} from "./reservation-access-cookie";

mock.module("server-only", () => ({}));

Object.assign(globalThis, { AsyncLocalStorage });

const { NextRequest } = await import("next/server");
const { createRequestStoreForAPI } = await import(
  "next/dist/server/async-storage/request-store"
);
const { createWorkStore } = await import(
  "next/dist/server/async-storage/work-store"
);
const { workAsyncStorage } = await import(
  "next/dist/server/app-render/work-async-storage.external"
);
const { workUnitAsyncStorage } = await import(
  "next/dist/server/app-render/work-unit-async-storage.external"
);

type RequestContext = {
  readonly requestStore: RequestStore;
  readonly workStore: WorkStore;
  readonly updatedCookies: string[][];
};

const createRequestContext = (): RequestContext => {
  const request = new NextRequest(
    "https://deskohub.test/en-US/reservation/submit"
  );
  const updatedCookies: string[][] = [];
  const requestStore = createRequestStoreForAPI(
    request,
    request.nextUrl,
    { tags: [], expirationsByCacheKind: new Map() },
    (cookies) => updatedCookies.push(cookies),
    undefined,
    undefined
  );
  const workStore = createWorkStore({
    page: "/[locale]/reservation/submit",
    renderOpts: {
      cacheComponents: false,
      cacheLifeProfiles: {
        default: { expire: 0, revalidate: 0, stale: 0 },
      },
      experimental: {
        authInterrupts: false,
        isRoutePPREnabled: false,
        useCacheTimeout: 30_000,
      },
      isPossibleServerAction: true,
      onAfterTaskError: undefined,
      onClose: () => undefined,
      staticPageGenerationTimeout: 300,
      supportsDynamicResponse: true,
      validationLevel: "warning",
      waitUntil: undefined,
    },
    buildId: "synthetic-build",
    deploymentId: "synthetic-deployment",
    previouslyRevalidatedTags: [],
  });

  return { requestStore, workStore, updatedCookies };
};

const runInRequest = <T>(context: RequestContext, effect: () => Promise<T>) =>
  workAsyncStorage.run(context.workStore, () =>
    workUnitAsyncStorage.run(context.requestStore, effect)
  );

const createCookieInput = async (suffix: string) => {
  const orderId = workspaceReservationIdSchema.make(
    `reservation-cookie-writer-${suffix}`
  );
  const capability = await Effect.runPromise(
    createReservationAccessCookieCapability({ orderId, locale: "en-US" })
  );

  return { orderId, capability };
};

const acquireWriter = async (context: RequestContext) => {
  const { ReservationAccessCookieWriter } = await import(
    "./reservation-access-cookie.server"
  );

  return runInRequest(context, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* ReservationAccessCookieWriter;
      }).pipe(Effect.provide(ReservationAccessCookieWriter.Live))
    )
  );
};

describe("ReservationAccessCookieWriter", () => {
  test("captures the request cookie store before a later context-free write", async () => {
    const context = createRequestContext();
    const writer = await acquireWriter(context);
    const input = await createCookieInput("late-write");

    await expect(
      Effect.runPromise(writer.write(input))
    ).resolves.toBeUndefined();

    expect(
      context.requestStore.mutableCookies.has(
        getReservationAccessCookieName(input.orderId)
      )
    ).toBe(true);
    expect(context.updatedCookies).toHaveLength(1);
  });

  test("keeps concurrent request stores isolated", async () => {
    const contextA = createRequestContext();
    const contextB = createRequestContext();
    const [writerA, writerB] = await Promise.all([
      acquireWriter(contextA),
      acquireWriter(contextB),
    ]);
    const [inputA, inputB] = await Promise.all([
      createCookieInput("request-a"),
      createCookieInput("request-b"),
    ]);

    await Promise.all([
      runInRequest(contextB, () => Effect.runPromise(writerA.write(inputA))),
      runInRequest(contextA, () => Effect.runPromise(writerB.write(inputB))),
    ]);

    expect(
      contextA.requestStore.mutableCookies.has(
        getReservationAccessCookieName(inputA.orderId)
      )
    ).toBe(true);
    expect(
      contextA.requestStore.mutableCookies.has(
        getReservationAccessCookieName(inputB.orderId)
      )
    ).toBe(false);
    expect(
      contextB.requestStore.mutableCookies.has(
        getReservationAccessCookieName(inputB.orderId)
      )
    ).toBe(true);
    expect(
      contextB.requestStore.mutableCookies.has(
        getReservationAccessCookieName(inputA.orderId)
      )
    ).toBe(false);
  });

  test("preserves Next's mutation guard after the request phase ends", async () => {
    const context = createRequestContext();
    const writer = await acquireWriter(context);
    const input = await createCookieInput("phase-guard");
    context.requestStore.phase = "render";

    await expect(Effect.runPromise(writer.write(input))).rejects.toThrow(
      "Cookies can only be modified in a Server Action or Route Handler"
    );
    expect(context.updatedCookies).toHaveLength(0);
  });
});
