import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import * as nextHeaders from "next/headers";
import {
  POSTHOG_DISTINCT_ID_COOKIE,
  POSTHOG_SESSION_ID_COOKIE,
} from "@/shared/utils/posthog-session-cookies";
import { toWorkspaceWebHandler } from "./workspace-effect";
import {
  currentRequestHeaders,
  currentVisitorIdentity,
} from "./workspace-request-context";
import { WorkspaceRouterRequestContext } from "./workspace-router-request-context";

const analyticsConsentCookie = `cc_cookie=${encodeURIComponent(
  JSON.stringify({ categories: ["necessary", "analytics"] })
)}`;

/** A request from `caller`, a consented visitor its PostHog cookies name. */
const request = (caller: string) =>
  new Request("https://workspace.deskohub.test/caller", {
    headers: {
      cookie: `${analyticsConsentCookie}; ${POSTHOG_DISTINCT_ID_COOKIE}=${caller}-distinct; ${POSTHOG_SESSION_ID_COOKIE}=${caller}-session`,
      "x-caller": caller,
    },
  });

/** Answers with the request context the route's handler sees. */
const reportContext = (
  beforeAnswering: (caller: string) => Effect.Effect<void>
) =>
  HttpRouter.add(
    "GET",
    "/caller",
    Effect.gen(function* () {
      const caller = (yield* currentRequestHeaders).get("x-caller") ?? "";
      yield* beforeAnswering(caller);
      const headers = yield* currentRequestHeaders;
      const visitor = yield* currentVisitorIdentity;
      return HttpServerResponse.jsonUnsafe({
        before: caller,
        after: headers.get("x-caller"),
        visitor,
      });
    })
  );

const nextRequestHeaders = spyOn(nextHeaders, "headers");

afterEach(() => {
  nextRequestHeaders.mockClear();
});

describe("WorkspaceRouterRequestContext", () => {
  test("gives each route the headers and visitor of its own request", async () => {
    const handle = toWorkspaceWebHandler(
      reportContext(() => Effect.void).pipe(
        Layer.provide(WorkspaceRouterRequestContext)
      )
    );

    const response = await handle(request("ada"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      before: "ada",
      after: "ada",
      visitor: { distinctId: "ada-distinct", sessionId: "ada-session" },
    });
    expect(nextRequestHeaders).not.toHaveBeenCalled();
  });

  test("keeps each of several concurrent requests' context its own", async () => {
    const callers = ["ada", "bea", "cyd", "dov"];
    const entered = new Map(
      callers.map((caller) => [caller, Promise.withResolvers<void>()])
    );
    const released = Promise.withResolvers<void>();
    const handle = toWorkspaceWebHandler(
      reportContext((caller) =>
        Effect.promise(() => {
          entered.get(caller)?.resolve();
          // Every other request enters, and its middleware runs, meanwhile.
          return released.promise;
        })
      ).pipe(Layer.provide(WorkspaceRouterRequestContext))
    );

    const responses = callers.map((caller) => handle(request(caller)));
    await Promise.all([...entered.values()].map(({ promise }) => promise));
    released.resolve();

    expect(
      await Promise.all(
        responses.map(async (response) => (await response).json())
      )
    ).toEqual(
      callers.map((caller) => ({
        before: caller,
        after: caller,
        visitor: {
          distinctId: `${caller}-distinct`,
          sessionId: `${caller}-session`,
        },
      }))
    );
    expect(nextRequestHeaders).not.toHaveBeenCalled();
  });

  test("leaves a router without it reading the headers from Next", async () => {
    const handle = toWorkspaceWebHandler(reportContext(() => Effect.void));

    const response = await handle(request("ada"));

    expect(response.status).toBe(500);
    expect(nextRequestHeaders).toHaveBeenCalled();
  });
});
