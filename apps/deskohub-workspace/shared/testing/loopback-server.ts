import { createServer } from "node:net";

export const allocateLoopbackPort = async (): Promise<number> => {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || !(address instanceof Object) || !("port" in address)) {
    await closeServer(server);
    throw new Error("loopback listener did not receive a TCP port");
  }

  const { port } = address;
  await closeServer(server);
  return port;
};

type OwnedServerOptions = {
  readonly exitCode: () => number | undefined;
  readonly marker: string;
  readonly pollIntervalMs?: number;
  readonly readyUrl: string;
  readonly timeoutMs: number;
};

export const waitForOwnedLoopbackServer = async ({
  exitCode,
  marker,
  pollIntervalMs = 50,
  readyUrl,
  timeoutMs,
}: OwnedServerOptions): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const childExitCode = exitCode();
    if (childExitCode !== undefined) {
      throw new Error(
        `owned loopback server exited before readiness (exit ${childExitCode})`
      );
    }

    if (await respondsWithMarker(readyUrl, marker)) return;
    await delay(pollIntervalMs);
  }

  throw new Error("owned loopback server did not return its readiness marker");
};

export const waitForOwnedLoopbackServerToStop = async ({
  marker,
  pollIntervalMs = 50,
  readyUrl,
  timeoutMs,
}: Omit<OwnedServerOptions, "exitCode">): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!(await respondsWithMarker(readyUrl, marker))) return;
    await delay(pollIntervalMs);
  }

  throw new Error("owned loopback server kept returning its readiness marker");
};

const respondsWithMarker = async (
  readyUrl: string,
  marker: string
): Promise<boolean> => {
  try {
    const response = await fetch(readyUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok && (await response.text()) === marker;
  } catch {
    return false;
  }
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
