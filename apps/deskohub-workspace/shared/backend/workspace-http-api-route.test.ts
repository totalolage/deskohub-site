import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { NextRequest } from "next/server";
import { runToCompletion } from "./run-to-completion";
import { toWorkspaceWebHandler } from "./workspace-effect";
import {
  continueMutationsAfterDisconnect,
  defineWorkspaceHttpApiRoute,
} from "./workspace-http-api-route";

const encoder = new TextEncoder();

/**
 * A route that reads its whole body, resolves `received` with it, waits for
 * `release`, then answers. `outcome` resolves once it either finished or was
 * interrupted.
 */
const slowRoute = (
  method: "GET" | "POST",
  options: { readonly toCompletion?: boolean } = {}
) => {
  const received = Promise.withResolvers<string>();
  const release = Promise.withResolvers<void>();
  const outcome = Promise.withResolvers<"finished" | "interrupted">();
  const handle = toWorkspaceWebHandler(
    HttpRouter.add(
      method,
      "/work",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        received.resolve(yield* Effect.orDie(request.text));
        const work = Effect.promise(() => release.promise).pipe(
          Effect.andThen(Effect.sync(() => outcome.resolve("finished")))
        );
        yield* options.toCompletion ? runToCompletion(work) : work;
        return HttpServerResponse.text("done");
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => outcome.resolve("interrupted"))
        )
      )
    )
  );
  return { handle, received, release, outcome };
};

/** A body that arrives as these chunks, one per read. */
const streamedBody = (...chunks: string[]) => {
  const pending = chunks.map((chunk) => encoder.encode(chunk));
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = pending.shift();
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
};

/** The request a client sends, with a streamed body unless it's a GET. */
const workRequest = (method: "GET" | "POST", signal: AbortSignal) =>
  new NextRequest("https://workspace.deskohub.test/work", {
    method,
    signal,
    ...(method === "POST" && {
      body: streamedBody("first chunk, ", "last chunk"),
      duplex: "half",
    }),
  });

/**
 * Sends a request, disconnects its client once the route received the whole
 * body, then releases the route. Effect interrupts on the abort before
 * `abort()` returns, so the release can't overtake it.
 */
const disconnectMidway = async (
  route: ReturnType<typeof slowRoute>,
  serve: (request: Request) => Promise<Response>,
  method: "GET" | "POST"
) => {
  const client = new AbortController();
  const response = serve(workRequest(method, client.signal));
  const received = await route.received.promise;
  client.abort();
  route.release.resolve();
  return { received, outcome: await route.outcome.promise, response };
};

describe("continueMutationsAfterDisconnect", () => {
  // The bug it fixes: Effect's web handler interrupts on `request.signal`,
  // whatever the Next route's `cancellation` says.
  test("Effect's web handler alone interrupts a mutation whose client disconnects", async () => {
    const route = slowRoute("POST");

    const { outcome } = await disconnectMidway(route, route.handle, "POST");

    expect(outcome).toBe("interrupted");
  });

  test("runs a mutation to completion after its client disconnects", async () => {
    const route = slowRoute("POST");

    const { outcome } = await disconnectMidway(
      route,
      continueMutationsAfterDisconnect(route.handle),
      "POST"
    );

    expect(outcome).toBe("finished");
  });

  test("still stops a GET whose client disconnects", async () => {
    const route = slowRoute("GET");

    const { outcome } = await disconnectMidway(
      route,
      continueMutationsAfterDisconnect(route.handle),
      "GET"
    );

    expect(outcome).toBe("interrupted");
  });
});

describe("defineWorkspaceHttpApiRoute", () => {
  /** A mutation route as the customer and admin API routes define one. */
  const mutationRoute = (handler: (request: Request) => Promise<Response>) =>
    defineWorkspaceHttpApiRoute(
      {
        operation: "workspaceHttpApiRouteTest",
        cancellation: "continue-after-disconnect",
        caller: "client",
        failureMessage: "The test request could not be completed.",
      },
      continueMutationsAfterDisconnect(handler)
    );

  test("completes a mutation whose streamed body it received after the client disconnects", async () => {
    const route = slowRoute("POST");

    const { received, outcome, response } = await disconnectMidway(
      route,
      mutationRoute(route.handle),
      "POST"
    );

    expect(received).toBe("first chunk, last chunk");
    expect(outcome).toBe("finished");
    const answer = await response;
    expect(answer.status).toBe(200);
    expect(await answer.text()).toBe("done");
  });

  /** A customer or admin API route, serving every method the same way. */
  const apiRoute = (
    cancellation: "interrupt-on-disconnect" | "continue-after-disconnect",
    handler: (request: Request) => Promise<Response>
  ) =>
    defineWorkspaceHttpApiRoute(
      {
        operation: "workspaceHttpApiRouteTest",
        cancellation,
        caller: "client",
        failureMessage: "The test request could not be completed.",
      },
      continueMutationsAfterDisconnect(handler)
    );

  /**
   * Disconnects a GET whose work runs to completion, then reports whether
   * the route answered before the work was released.
   */
  const answeredBeforeRelease = async (
    cancellation: "interrupt-on-disconnect" | "continue-after-disconnect"
  ) => {
    const route = slowRoute("GET", { toCompletion: true });
    const client = new AbortController();
    let answered = false;
    // An interrupted runner rejects; either way the route has answered.
    const response = apiRoute(
      cancellation,
      route.handle
    )(workRequest("GET", client.signal)).then(
      () => {
        answered = true;
      },
      () => {
        answered = true;
      }
    );
    await route.received.promise;
    client.abort();
    await Bun.sleep(20);
    const before = answered;
    route.release.resolve();
    await response;
    return { before, outcome: await route.outcome.promise };
  };

  // The route's runner stops waiting for its handler on the abort, so the
  // platform may end the invocation while the work still runs.
  test("an interrupting route answers before a GET's run-to-completion work ends", async () => {
    expect(await answeredBeforeRelease("interrupt-on-disconnect")).toEqual({
      before: true,
      outcome: "finished",
    });
  });

  test("a continuing route waits for a GET's run-to-completion work", async () => {
    expect(await answeredBeforeRelease("continue-after-disconnect")).toEqual({
      before: false,
      outcome: "finished",
    });
  });

  test("a continuing route still stops an ordinary GET whose client disconnects", async () => {
    const route = slowRoute("GET");

    const { outcome } = await disconnectMidway(
      route,
      apiRoute("continue-after-disconnect", route.handle),
      "GET"
    );

    expect(outcome).toBe("interrupted");
  });
});
