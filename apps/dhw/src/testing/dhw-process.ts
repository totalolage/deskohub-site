import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { productionOrigin } from "../config/dhw-config.service";
import { testNetworkEnvironment } from "./test-isolation.preload";

const isolationPreload = new URL("./test-isolation.preload.ts", import.meta.url)
  .pathname;
const sourceEntrypoint = new URL("../main.ts", import.meta.url).pathname;

/** Runs `dhw` from source without `.env` files and with the test isolation preload. */
export const dhwFromSource = [
  process.execPath,
  "--no-env-file",
  "--preload",
  isolationPreload,
  sourceEntrypoint,
];

/** A run from source starts slowly on a busy machine. */
export const dhwRunTimeout = 60_000;

export type DhwRun = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The first line of every request that tried to leave the machine. */
  readonly egress: ReadonlyArray<string>;
};

/**
 * Runs `dhw` in a subprocess that inherits nothing from the caller's
 * environment. It gets a fresh home and state directory and a process-local
 * credential store, and every request to anything but localhost goes to a
 * trap that records and refuses it. Callers choose only the Workspace and,
 * for source runs whose preload blocks it, the system credential store.
 */
export const runDhw = async (
  args: ReadonlyArray<string>,
  options: {
    readonly executable?: ReadonlyArray<string>;
    readonly workspace?: string;
    readonly credentialStore?: "memory" | "system";
  } = {}
): Promise<DhwRun> => {
  if (
    options.workspace !== undefined &&
    new URL(options.workspace).origin === productionOrigin.origin
  ) {
    throw new Error("dhw tests never select the production Workspace.");
  }
  if (
    options.executable !== undefined &&
    options.credentialStore === "system"
  ) {
    throw new Error(
      "Only a run from source blocks the system credential store."
    );
  }

  const egress: Array<string> = [];
  const trap = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        egress.push(data.toString().split("\r\n", 1)[0] ?? "");
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      },
    },
  });
  const home = mkdtempSync(join(tmpdir(), "dhw-test-"));

  try {
    const child = Bun.spawn(
      [...(options.executable ?? dhwFromSource), ...args],
      {
        cwd: home,
        env: {
          PATH: process.env.PATH ?? "",
          TMPDIR: tmpdir(),
          HOME: home,
          DHW_STATE_DIR: join(home, "state"),
          DHW_CREDENTIAL_STORE: options.credentialStore ?? "memory",
          DHW_NO_UPDATE_CHECK: "true",
          ...(options.workspace === undefined
            ? {}
            : { DHW_BASE: options.workspace }),
          ...testNetworkEnvironment(`http://127.0.0.1:${trap.port}`),
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: dhwRunTimeout - 10_000,
      }
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    return { exitCode, stdout, stderr, egress };
  } finally {
    trap.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
};
