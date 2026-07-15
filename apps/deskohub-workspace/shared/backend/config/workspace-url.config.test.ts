import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";

type CallbackEnvironmentName =
  | "VERCEL_ENV"
  | "VERCEL_PROJECT_PRODUCTION_URL"
  | "VERCEL_URL"
  | "WORKSPACE_CALLBACK_ORIGIN";

const getOrigin = (
  overrides: Partial<Record<CallbackEnvironmentName, string | undefined>>
) => {
  const environment = { ...process.env };

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }

  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "--eval",
      `
        import { Effect } from "effect";
        const { getWorkspaceRuntimeCallbackOrigin } = await import(
          "./shared/backend/config/workspace-url.config.ts"
        );
        console.log(
          (await Effect.runPromise(getWorkspaceRuntimeCallbackOrigin)).origin
        );
      `,
    ],
    cwd: process.cwd(),
    env: environment,
  });

  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trim();
};

test("selects the callback origin from the runtime environment", () => {
  expect(
    getOrigin({
      VERCEL_ENV: "preview",
      VERCEL_URL: "preview-a.vercel.app",
      WORKSPACE_CALLBACK_ORIGIN: undefined,
    })
  ).toBe("https://preview-a.vercel.app");

  expect(
    getOrigin({
      VERCEL_ENV: "preview",
      VERCEL_URL: "preview-b.vercel.app",
      WORKSPACE_CALLBACK_ORIGIN: undefined,
    })
  ).toBe("https://preview-b.vercel.app");

  expect(
    getOrigin({
      VERCEL_ENV: "preview",
      VERCEL_URL: "preview-b.vercel.app",
      WORKSPACE_CALLBACK_ORIGIN: "https://new.workspace.deskohub.cz",
    })
  ).toBe("https://new.workspace.deskohub.cz");

  expect(
    getOrigin({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "workspace.deskohub.cz",
      VERCEL_URL: "ignored.vercel.app",
      WORKSPACE_CALLBACK_ORIGIN: "https://ignored.example",
    })
  ).toBe("https://workspace.deskohub.cz");
});
