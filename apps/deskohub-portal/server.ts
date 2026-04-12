import { fileURLToPath } from "node:url";

import {
  assertProductionBuildReady,
  createPortalRequestHandler,
} from "./portal-server";

const appDirectory = fileURLToPath(new URL(".", import.meta.url));
const isDevelopment = process.env.NODE_ENV === "development";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const vitePort = Number.parseInt(process.env.VITE_PORT ?? "5173", 10);
const viteOrigin = `http://127.0.0.1:${vitePort}`;

await assertProductionBuildReady({
  appDirectory,
  isDevelopment,
});

const handleRequest = createPortalRequestHandler({
  appDirectory,
  isDevelopment,
  viteOrigin,
});

const server = Bun.serve({
  port,
  development: isDevelopment,
  fetch: handleRequest,
});

if (server.port !== port) {
  throw new Error(`Portal server failed to bind to port ${port}.`);
}
