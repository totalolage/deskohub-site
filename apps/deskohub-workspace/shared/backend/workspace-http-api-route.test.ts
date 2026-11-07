import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { toWorkspaceWebHandler } from "./workspace-effect";
import { continueMutationsAfterDisconnect } from "./workspace-http-api-route";

/**
 * A route that starts, waits for `release`, then records that it finished;
 * `started` resolves once it runs.
 */
const slowRoute = (method: "GET" | "POST") => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const finished: string[] = [];
  const handle = toWorkspaceWebHandler(
    HttpRouter.add(
      method,
      "/work",
      Effect.sync(() => started.resolve()).pipe(
        Effect.andThen(Effect.promise(() => release.promise)),
        Effect.andThen(
          Effect.sync(() => {
            finished.push(method);
            return HttpServerResponse.text("done");
          })
        )
      )
    )
  );
  return { handle, started, release, finished };
};

/** Sends a request, disconnects once the route runs, then releases it. */
const disconnectMidway = async (
  route: ReturnType<typeof slowRoute>,
  serve: (request: Request) => Promise<Response>,
  method: "GET" | "POST"
) => {
  const client = new AbortController();
  void serve(
    new Request("https://workspace.deskohub.test/work", {
      method,
      signal: client.signal,
    })
  );
  await route.started.promise;
  client.abort();
  await Bun.sleep(10);
  route.release.resolve();
  await Bun.sleep(10);
  return route.finished;
};

describe("continueMutationsAfterDisconnect", () => {
  // The bug it fixes: Effect's web handler interrupts on `request.signal`,
  // whatever the Next route's `cancellation` says.
  test("Effect's web handler alone interrupts a mutation whose client disconnects", async () => {
    const route = slowRoute("POST");

    expect(await disconnectMidway(route, route.handle, "POST")).toEqual([]);
  });

  test("runs a mutation to completion after its client disconnects", async () => {
    const route = slowRoute("POST");

    expect(
      await disconnectMidway(
        route,
        continueMutationsAfterDisconnect(route.handle),
        "POST"
      )
    ).toEqual(["POST"]);
  });

  test("still stops a GET whose client disconnects", async () => {
    const route = slowRoute("GET");

    expect(
      await disconnectMidway(
        route,
        continueMutationsAfterDisconnect(route.handle),
        "GET"
      )
    ).toEqual([]);
  });
});
