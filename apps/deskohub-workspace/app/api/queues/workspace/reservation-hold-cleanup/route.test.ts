import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { expect, spyOn, test } from "bun:test";
import { CENSORED_LOG_VALUE } from "@/shared/backend/logging/censorship";
import { processCleanupMessage } from "./route";

test("runs the real cleanup queue task with its closed operation projection", async () => {
  const log = spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    await processCleanupMessage({ schemaVersion: 2 });

    expect(log).toHaveBeenCalledTimes(1);
    const output = log.mock.calls.flat().join(" ");
    expect(output).toContain("operation=reservationHoldCleanupSchedule");
    expect(output).not.toContain(`operation=${CENSORED_LOG_VALUE}`);
  } finally {
    log.mockRestore();
  }
});
