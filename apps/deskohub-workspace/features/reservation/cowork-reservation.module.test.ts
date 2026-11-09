import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "@/scripts/shared/command";

test("cowork reservation can load before Temporal instrumentation", async () => {
  const result = await runCommand(
    [
      "bun",
      "-e",
      'delete globalThis.Temporal; await import("./features/reservation/cowork-reservation.ts")',
    ],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)) }
  );

  expect(result.exitCode).toBe(0);
});
