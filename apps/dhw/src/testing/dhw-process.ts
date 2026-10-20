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
 * trap that records and refuses it.
 */
export const runDhw = async (
  args: ReadonlyArray<string>,
  options: {
    readonly executable?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
): Promise<DhwRun> => {
  const selectedBase = options.env?.DHW_BASE;
  if (
    selectedBase !== undefined &&
    URL.canParse(selectedBase) &&
    new URL(selectedBase).origin === productionOrigin.origin
  ) {
    throw new Error("dhw tests never select the production Workspace.");
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
          DHW_CREDENTIAL_STORE: "memory",
          DHW_NO_UPDATE_CHECK: "true",
          ...testNetworkEnvironment(`http://127.0.0.1:${trap.port}`),
          ...options.env,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
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
