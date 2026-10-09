/**
 * Caller process for the shutdown listener tests: registers its own
 * one-shot SIGTERM listener (appended or prepended, before or after running a
 * command), then reports
 * readiness and stays alive. The listener records that it handled the signal
 * in the file named by the first argument, so a test can check that the
 * caller handled SIGTERM itself and was not ended by a re-raised signal.
 */
import { writeFileSync } from "node:fs";
import { runCommand } from "./command";

const listenerKinds = [
  "once-before",
  "once-after",
  "prepend-once-after",
  "prepend-self-removing-after",
] as const;
type ListenerKind = (typeof listenerKinds)[number];

const [handledFile, kindArgument] = Bun.argv.slice(2);
const kind = listenerKinds.find((candidate) => candidate === kindArgument);
if (handledFile === undefined || kind === undefined) {
  throw new Error(
    `usage: command.listener-fixture.ts <handled-file> <${listenerKinds.join("|")}>`
  );
}

const handle = () => writeFileSync(handledFile, "handled");
const listen = (listenerKind: ListenerKind) => {
  if (listenerKind === "prepend-once-after") {
    process.prependOnceListener("SIGTERM", handle);
  } else if (listenerKind === "prepend-self-removing-after") {
    const handleOnce = () => {
      process.off("SIGTERM", handleOnce);
      handle();
    };
    process.prependListener("SIGTERM", handleOnce);
  } else {
    process.once("SIGTERM", handle);
  }
};

if (kind === "once-before") listen(kind);
await runCommand(["bash", "-c", "exit 0"]);
if (kind !== "once-before") listen(kind);
process.stdout.write("ready\n");
setInterval(() => undefined, 1_000);
