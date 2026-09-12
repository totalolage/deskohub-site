import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workspaceDir, writeJsonAtomically } from "../runtime";
import type { E2ERunContext } from "../services/telemetry";

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
