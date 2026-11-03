import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mockWorkspaceActionRequest } from "./workspace-action-request.test-utils";

const request = await mockWorkspaceActionRequest();

const { getRequestHeaders } = await import(
  "@/shared/backend/utils/request-headers"
);
const { getRequestCookies } = await import(
  "@/shared/backend/utils/request-cookies"
);
const { runWorkspaceEffectAfterResponse } = await import(
  "@/shared/backend/workspace-effect"
);
const { BotProtectionService } = await import(
  "@/shared/backend/bot-protection/bot-protection.service"
);
const nextServer = await import("next/server");

beforeEach(() => {
  request.reset();
});

describe("mockWorkspaceActionRequest", () => {
  test("sends the en-US referer until a test changes or removes it", async () => {
    const referer = async () =>
      (await Effect.runPromise(getRequestHeaders)).get("referer");

    expect(await referer()).toBe("https://deskohub.test/en-US");

    request.setReferer("https://deskohub.test/cs-CZ/admin");
    expect(await referer()).toBe("https://deskohub.test/cs-CZ/admin");

    request.setReferer(null);
    expect(await referer()).toBeNull();

    request.reset();
    expect(await referer()).toBe("https://deskohub.test/en-US");
  });

  test("reads back what the code wrote and records each write", async () => {
    request.setCookie("seeded", "from-browser");
    const cookies = await Effect.runPromise(getRequestCookies);

    expect(cookies.get("seeded")?.value).toBe("from-browser");
    expect(request.cookieWrites()).toEqual([]);

    cookies.set("written", "by-action");
    cookies.delete("seeded");

    expect(cookies.get("written")?.value).toBe("by-action");
    expect(cookies.has("seeded")).toBe(false);
    expect(request.cookie("written")).toBe("by-action");
    expect(request.cookieWrites()).toEqual([
      { name: "written", value: "by-action" },
      { name: "seeded", value: undefined },
    ]);

    request.reset();
    expect(request.cookie("written")).toBeUndefined();
    expect(request.cookieWrites()).toEqual([]);
  });

  test("hands work after the response to `after` without running it", async () => {
    let ran = false;

    await Effect.runPromise(
      runWorkspaceEffectAfterResponse(
        "test.after-response",
        Effect.sync(() => {
          ran = true;
        })
      )
    );

    expect(request.after).toHaveBeenCalledTimes(1);
    expect(ran).toBe(false);

    const [[callback]] = request.after.mock.calls as [[() => unknown]];
    await callback();
    expect(ran).toBe(true);
  });

  test("keeps the rest of `next/server` real", () => {
    expect(new nextServer.NextResponse("ok").status).toBe(200);
  });

  test("leaves BotID unenforced unless a verdict is installed", async () => {
    await Effect.gen(function* () {
      const protection = yield* BotProtectionService;
      yield* protection.verifyHuman({
        verificationFailurePolicy: "deny",
        verifiedBots: "deny",
        callSite: "reservation.prepare-pay-state",
      });
    }).pipe(Effect.provide(BotProtectionService.Default), Effect.runPromise);

    expect(request.checkBotId).not.toHaveBeenCalled();
  });
});
