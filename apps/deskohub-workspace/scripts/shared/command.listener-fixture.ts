/**
 * Caller process for the shutdown listener tests: registers its own
 * one-shot SIGTERM listener before or after running a command, then reports
 * readiness and stays alive. The listener records that it handled the signal
 * in the file named by the first argument, so a test can check that the
 * caller handled SIGTERM itself and was not ended by a re-raised signal.
 */
import { writeFileSync } from "node:fs";
import { runCommand } from "./command";

const [handledFile, order] = Bun.argv.slice(2);
if (handledFile === undefined || (order !== "before" && order !== "after")) {
  throw new Error(
    "usage: command.listener-fixture.ts <handled-file> <before|after>"
  );
}

const listen = () =>
  process.once("SIGTERM", () => writeFileSync(handledFile, "handled"));

if (order === "before") listen();
await runCommand(["bash", "-c", "exit 0"]);
if (order === "after") listen();
process.stdout.write("ready\n");
setInterval(() => undefined, 1_000);
