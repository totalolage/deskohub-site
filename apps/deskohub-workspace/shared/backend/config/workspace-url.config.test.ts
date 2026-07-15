import { expect, mock, test } from "bun:test";
import { Effect } from "effect";

const runtimeEnv: {
  VERCEL_ENV: "development" | "preview" | "production";
  VERCEL_PROJECT_PRODUCTION_URL: string;
  VERCEL_URL: string;
  WORKSPACE_CALLBACK_ORIGIN?: string;
} = {
  VERCEL_ENV: "preview",
  VERCEL_PROJECT_PRODUCTION_URL: "workspace.deskohub.cz",
  VERCEL_URL: "preview-a.vercel.app",
};

mock.module("@/env", () => ({ env: runtimeEnv }));

test("selects the callback origin when the Effect runs", async () => {
  const { getWorkspaceRuntimeCallbackOrigin } = await import(
    "./workspace-url.config"
  );
  const getOrigin = () =>
    Effect.runPromise(getWorkspaceRuntimeCallbackOrigin).then(
      (url) => url.origin
    );

  expect(await getOrigin()).toBe("https://preview-a.vercel.app");

  runtimeEnv.VERCEL_URL = "preview-b.vercel.app";
  expect(await getOrigin()).toBe("https://preview-b.vercel.app");

  runtimeEnv.WORKSPACE_CALLBACK_ORIGIN = "https://new.workspace.deskohub.cz";
  expect(await getOrigin()).toBe("https://new.workspace.deskohub.cz");

  runtimeEnv.VERCEL_ENV = "production";
  expect(await getOrigin()).toBe("https://workspace.deskohub.cz");
});
