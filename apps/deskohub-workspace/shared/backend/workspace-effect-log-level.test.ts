import { describe, expect, mock, test } from "bun:test";
import { Effect, type LogLevel, References } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import * as workspaceEnv from "@/env";
import { captureWorkspaceLogs } from "@/shared/testing/workspace-telemetry.test-utils";

const workspaceLogs = captureWorkspaceLogs();
const nextServer = await import("next/server");

// Outside a Next request, scheduling the telemetry flush would log a warning.
mock.module("next/server", () => ({ ...nextServer, after: () => undefined }));

interface LogLevelPolicy {
  readonly VERCEL_ENV: "production" | "preview" | "development";
  readonly WORKSPACE_LOG_LEVEL: LogLevel.LogLevel | undefined;
}

let logLevelPolicy: LogLevelPolicy = {
  VERCEL_ENV: "development",
  WORKSPACE_LOG_LEVEL: undefined,
};

mock.module("@/env", () => ({
  ...workspaceEnv,
  env: new Proxy(workspaceEnv.env, {
    get: (target, key) =>
      key === "VERCEL_ENV" || key === "WORKSPACE_LOG_LEVEL"
        ? logLevelPolicy[key]
        : Reflect.get(target, key),
  }),
}));

/**
 * The Workspace runtime entry points of a fresh module instance, whose
 * runtime builds its observability under `policy` on its first run. The
 * runtime reads the policy once per process, so each case needs its own.
 */
const workspaceRuntimeUnder = async (
  policy: LogLevelPolicy
): Promise<typeof import("./workspace-effect")> => {
  logLevelPolicy = policy;
  return await import(
    `./workspace-effect?${policy.VERCEL_ENV}-${policy.WORKSPACE_LOG_LEVEL ?? "default"}`
  );
};

/** Logs one Debug and one Info record, then reads the run's minimum level. */
const logLevelProbe = (probe: string) =>
  Effect.gen(function* () {
    yield* Effect.logDebug("log level probe");
    yield* Effect.logInfo("log level probe");
    return yield* References.MinimumLogLevel;
  }).pipe(Effect.annotateLogs({ probe }));

/** Severities of the records `probe` emitted, in order. */
const probeSeverities = (probe: string) =>
  workspaceLogs
    .records()
    .filter(({ attributes }) => attributes?.probe === probe)
    .map(({ severityText }) => severityText);

/**
 * The minimum level each entry point gives its effects, and the severities
 * each emitted, for a runtime built under `policy`.
 */
const observeEntryPoints = async (policy: LogLevelPolicy) => {
  const { runWorkspaceEffect, toWorkspaceWebHandler } =
    await workspaceRuntimeUnder(policy);
  const runProbe = `run:${policy.VERCEL_ENV}:${policy.WORKSPACE_LOG_LEVEL}`;
  const handlerProbe = `handler:${policy.VERCEL_ENV}:${policy.WORKSPACE_LOG_LEVEL}`;

  const runLevel = await logLevelProbe(runProbe).pipe(
    runWorkspaceEffect("test.log-level")
  );
  const handler = toWorkspaceWebHandler(
    HttpRouter.add(
      "GET",
      "/log-level",
      logLevelProbe(handlerProbe).pipe(Effect.map(HttpServerResponse.text))
    )
  );
  const response = await handler(
    new Request("https://workspace.deskohub.test/log-level")
  );

  return {
    handler: {
      level: await response.text(),
      severities: probeSeverities(handlerProbe),
    },
    run: { level: runLevel, severities: probeSeverities(runProbe) },
  };
};

describe("Workspace runtime minimum log level", () => {
  test("keeps production runs and handlers at Info, dropping Debug records", async () => {
    const observed = await observeEntryPoints({
      VERCEL_ENV: "production",
      WORKSPACE_LOG_LEVEL: undefined,
    });

    expect(observed).toEqual({
      handler: { level: "Info", severities: ["info"] },
      run: { level: "Info", severities: ["info"] },
    });
  });

  test("includes Debug records in runs and handlers outside production", async () => {
    const observed = await observeEntryPoints({
      VERCEL_ENV: "preview",
      WORKSPACE_LOG_LEVEL: undefined,
    });

    expect(observed).toEqual({
      handler: { level: "Debug", severities: ["debug", "info"] },
      run: { level: "Debug", severities: ["debug", "info"] },
    });
  });

  test("honors WORKSPACE_LOG_LEVEL over the production default", async () => {
    const observed = await observeEntryPoints({
      VERCEL_ENV: "production",
      WORKSPACE_LOG_LEVEL: "Debug",
    });

    expect(observed).toEqual({
      handler: { level: "Debug", severities: ["debug", "info"] },
      run: { level: "Debug", severities: ["debug", "info"] },
    });
  });
});
