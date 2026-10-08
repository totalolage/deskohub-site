import { expect, test } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import {
  allocateLoopbackPort,
  waitForOwnedLoopbackServer,
  waitForOwnedLoopbackServerToStop,
} from "./loopback-server";

const openServer = async (body: string) => {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/plain",
      connection: "close",
    });
    response.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || !(address instanceof Object) || !("port" in address)) {
    await closeServer(server);
    throw new Error("test server did not receive a TCP port");
  }

  return {
    close: () => closeHttpServer(server),
    url: `http://127.0.0.1:${address.port}/ready`,
  };
};

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const closeHttpServer = (server: ReturnType<typeof createHttpServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });

test("allocates a bindable loopback port", async () => {
  const port = await allocateLoopbackPort();
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  await closeServer(server);
});

test("does not accept an unrelated HTTP 200 as owned readiness", async () => {
  const server = await openServer("another fixture");
  const exitCode = { value: undefined as number | undefined };

  try {
    await expect(
      waitForOwnedLoopbackServer({
        exitCode: () => exitCode.value,
        marker: "this fixture",
        pollIntervalMs: 5,
        readyUrl: server.url,
        timeoutMs: 30,
      })
    ).rejects.toThrow("did not return its readiness marker");
    expect((await fetch(server.url)).status).toBe(200);
  } finally {
    await server.close();
  }
});

test("fails readiness promptly when the owned child exits", async () => {
  const exitCode = { value: 1 as number | undefined };

  await expect(
    waitForOwnedLoopbackServer({
      exitCode: () => exitCode.value,
      marker: "this fixture",
      readyUrl: "http://127.0.0.1:1/ready",
      timeoutMs: 10_000,
    })
  ).rejects.toThrow("exited before readiness (exit 1)");
});

test("owned-server stop polling leaves another listener untouched", async () => {
  const server = await openServer("another fixture");

  try {
    await waitForOwnedLoopbackServerToStop({
      marker: "this fixture",
      readyUrl: server.url,
      timeoutMs: 100,
    });
    expect((await fetch(server.url)).status).toBe(200);
  } finally {
    await server.close();
  }
});
