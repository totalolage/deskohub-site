import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withNextAppFixture } from "./next-app-fixture.test-utils";

const isRunning = async (pid: number) => {
  // A killed process whose parent is gone may linger as a zombie until it is
  // reaped; it no longer runs.
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
  return stat !== "" && !/^\d+ \(.*\) Z /.test(stat);
};

test("kills a production build that outlasts its timeout, with its descendants", {
  timeout: 60_000,
}, async () => {
  const probeDirectory = await mkdtemp(
    join(tmpdir(), "next-build-timeout-probe-")
  );
  const pidFile = join(probeDirectory, "descendant.pid");
  try {
    const [outcome] = await Promise.allSettled([
      withNextAppFixture(
        {
          buildTimeoutMs: 5_000,
          files: {
            // The build loads this config, starts a descendant, and never
            // finishes.
            "next.config.mjs": `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const descendant = spawn("sleep", ["600"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));
await new Promise(() => setInterval(() => {}, 1_000));
export default {};
`,
          },
          mode: "production",
          name: "next-build-timeout",
        },
        async () => "served"
      ),
    ]);

    expect(outcome).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringContaining("timed out"),
      }),
      status: "rejected",
    });
    const descendantPid = Number(await readFile(pidFile, "utf8"));
    expect(await isRunning(descendantPid)).toBe(false);
  } finally {
    await rm(probeDirectory, { force: true, recursive: true });
  }
});
