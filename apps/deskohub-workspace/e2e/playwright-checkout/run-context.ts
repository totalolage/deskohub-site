import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { E2EEnvironment } from "../e2e-env";
import { workspaceDir, writeJsonAtomically } from "../runtime";
import { type E2ERunContext, makeE2ERunContext } from "../services/telemetry";

const runContextPath = resolve(
  workspaceDir,
  "e2e-artifacts",
  "checkout",
  "run-context.json"
);

export const writeWorkspaceE2ERunContext = async (value: E2ERunContext) =>
  writeJsonAtomically(runContextPath, value);

export const readWorkspaceE2ERunContext = async (): Promise<E2ERunContext> =>
  parseRunContext(await readFile(runContextPath, "utf8"));

// Only a confirmed missing file counts as absent; any other access failure
// reports the context as present so its cleanup still runs.
export const hasWorkspaceE2ERunContext = (): Promise<boolean> =>
  access(runContextPath).then(
    () => true,
    (cause: unknown) =>
      !(cause instanceof Error && "code" in cause && cause.code === "ENOENT")
  );

/**
 * The run context the launcher passes every Playwright invocation, or a fresh
 * manual one when a config runs on its own.
 */
export const resolveWorkspaceE2ERunContext = (
  environment: E2EEnvironment
): E2ERunContext => {
  const serialized = environment.WORKSPACE_E2E_RUN_CONTEXT;
  return serialized
    ? parseRunContext(serialized)
    : makeE2ERunContext(environment);
};

const parseRunContext = (serialized: string): E2ERunContext => {
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    !isRecord(value.allocation)
  ) {
    throw new Error("Invalid workspace E2E run context");
  }
  return value as E2ERunContext;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
