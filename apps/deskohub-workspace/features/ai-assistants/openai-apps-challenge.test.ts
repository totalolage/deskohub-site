// Bun skips dot directories when it collects tests, so the `.well-known`
// route is covered here, next to its handler.

import { describe, expect, mock, test } from "bun:test";
import * as envModule from "@/env";

// The workspace env object is read once at import; route the token through
// a switchable override so one file covers a set and an unset token.
let token: string | undefined;
mock.module("@/env", () => ({
  ...envModule,
  env: new Proxy(envModule.env, {
    get: (target, key) =>
      key === "OPENAI_APPS_CHALLENGE_TOKEN" ? token : Reflect.get(target, key),
  }),
}));

const { GET } = await import("@/app/.well-known/openai-apps-challenge/route");

const challenge = (configured: string | undefined): Response => {
  token = configured;
  return GET();
};

describe("OpenAI apps domain challenge", () => {
  test("serves exactly the configured token as plain text", async () => {
    const response = challenge("synthetic-challenge-token");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(await response.text()).toBe("synthetic-challenge-token");
  });

  test("is not found while no token is configured", async () => {
    const response = challenge(undefined);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});
