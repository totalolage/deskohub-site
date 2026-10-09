import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "@/scripts/shared/command";

test("reservation date utilities can load before Temporal instrumentation", async () => {
  const result = await runCommand(
    [
      "bun",
      "-e",
      'delete globalThis.Temporal; await import("./features/reservation/reservation-date.ts")',
    ],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)) }
  );

  expect(result.exitCode).toBe(0);
});

test("reservation date-time picker can load before Temporal instrumentation", async () => {
  const result = await runCommand(
    [
      "bun",
      "-e",
      'delete globalThis.Temporal; await import("./features/reservation/components/reservation-date-time-picker.tsx")',
    ],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)) }
  );

  expect(result.exitCode).toBe(0);
});
