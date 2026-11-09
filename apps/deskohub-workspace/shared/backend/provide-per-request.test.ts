import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Context, Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { providePerRequest } from "./provide-per-request";
import { toWorkspaceWebHandler } from "./workspace-effect";

const instances = { handler: 0, request: 0, nested: 0 };

/** Built once by the handler, as an API's shared services are. */
class HandlerOwn extends Context.Service<HandlerOwn, { readonly id: number }>()(
  "test/HandlerOwn"
) {
  static Live = Layer.sync(this, () => ({ id: ++instances.handler }));
}

/** A request's own service, built over what the handler built. */
class RequestOwn extends Context.Service<
  RequestOwn,
  { readonly id: number; readonly handler: number }
>()("test/RequestOwn") {
  static Live = Layer.effect(
    this,
    Effect.map(HandlerOwn, (handler) => ({
      id: ++instances.request,
      handler: handler.id,
    }))
  );
}

/** A service the request provides again with a plain `Effect.provide`. */
class NestedOwn extends Context.Service<NestedOwn, { readonly id: number }>()(
  "test/NestedOwn"
) {
  static Live = Layer.sync(this, () => ({ id: ++instances.nested }));
}

const Answer = Schema.Struct({
  handler: Schema.Number,
  request: Schema.Number,
  nested: Schema.Number,
});
const Api = HttpApi.make("test").add(
  HttpApiGroup.make("instances").add(
    HttpApiEndpoint.get("plain", "/plain", { success: Answer }),
    HttpApiEndpoint.get("perRequest", "/per-request", { success: Answer })
  )
);

const overlapping = 3;

/**
 * The API under one handler. Each endpoint holds every request until
 * `overlapping` of them are running, so they all overlap.
 */
const serveInstances = () => {
  let started = 0;
  const allStarted = Promise.withResolvers<void>();
  const answer = Effect.gen(function* () {
    const request = yield* RequestOwn;
    // Held inside the nested provide, so the nested builds overlap too.
    const nested = yield* Effect.tap(NestedOwn, () => {
      started += 1;
      if (started === overlapping) allStarted.resolve();
      return Effect.promise(() => allStarted.promise);
    }).pipe(Effect.provide(NestedOwn.Live));
    return { handler: request.handler, request: request.id, nested: nested.id };
  });
  const handlers = HttpApiBuilder.group(Api, "instances", (group) =>
    group
      .handle("plain", () => answer.pipe(Effect.provide(RequestOwn.Live)))
      .handle("perRequest", () =>
        answer.pipe(providePerRequest(RequestOwn.Live))
      )
  );
  const handle = toWorkspaceWebHandler(
    HttpApiBuilder.layer(Api).pipe(
      Layer.provide(handlers),
      Layer.provide(HandlerOwn.Live)
    )
  );
  return (path: string) =>
    Promise.all(
      Array.from({ length: overlapping }, async () =>
        Schema.decodeUnknownSync(Answer)(
          await (
            await handle(new Request(`https://workspace.deskohub.test${path}`))
          ).json()
        )
      )
    );
};

describe("providePerRequest", () => {
  test("gives each of several overlapping API requests its own Layers over what the handler built", async () => {
    const answers = await serveInstances()("/per-request");

    expect(new Set(answers.map(({ handler }) => handler)).size).toBe(1);
    expect(new Set(answers.map(({ request }) => request)).size).toBe(
      overlapping
    );
    expect(new Set(answers.map(({ nested }) => nested)).size).toBe(overlapping);
  });

  test("is needed: a plain provide shares one instance between overlapping API requests", async () => {
    const answers = await serveInstances()("/plain");

    expect(new Set(answers.map(({ request }) => request)).size).toBe(1);
    expect(new Set(answers.map(({ nested }) => nested)).size).toBe(1);
  });

  test("reuses a Layer the enclosing memo map already built", async () => {
    const reused = await Effect.gen(function* () {
      const outer = yield* HandlerOwn;
      const inner = yield* Effect.map(HandlerOwn, ({ id }) => id).pipe(
        providePerRequest(HandlerOwn.Live)
      );
      return [outer.id, inner];
    }).pipe(Effect.provide(HandlerOwn.Live), Effect.runPromise);

    expect(reused[0]).toBe(reused[1]);
  });
});
