import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("reservation date utilities can load before Temporal instrumentation", () => {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      'delete globalThis.Temporal; await import("./features/reservation/reservation-date.ts")',
    ],
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
});

test("date-time picker can load before Temporal instrumentation", () => {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      'delete globalThis.Temporal; await import("./shared/components/ui/date-time-picker.tsx")',
    ],
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
});

test("meeting-room date-time picker can render before Temporal instrumentation", () => {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `
        delete globalThis.Temporal;
        const React = await import("react");
        const { renderToString } = await import("react-dom/server");
        const { DateTimePicker } = await import("./shared/components/ui/date-time-picker.tsx");
        const { getEarliestMeetingRoomStartDateTime } = await import("./features/reservation/meeting-room-reservation-time.ts");
        renderToString(React.createElement(DateTimePicker, { minimum: getEarliestMeetingRoomStartDateTime }));
      `,
    ],
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
});
