import { afterEach, describe, expect, test } from "bun:test";
import { productionOrigin } from "./config/dhw-config.service";
import { dhwRunTimeout, runDhw } from "./testing/dhw-process";

const servers: Array<Bun.Server<undefined>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

const startLocalWorkspace = () => {
  const requests: Array<string> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      requests.push(new URL(request.url).pathname);
      return new Response(null, { status: 503 });
    },
  });
  servers.push(server);
  return { base: server.url.origin, requests };
};

describe("dhw run from source", () => {
  test(
    "fails closed without a selected Workspace",
    async () => {
      const run = await runDhw(["overview", "--json"]);

      expect(run.exitCode).not.toBe(0);
      expect(run.stdout + run.stderr).toContain(
        "This dhw build has no default Workspace"
      );
      expect(run.egress).toEqual([]);
    },
    dhwRunTimeout
  );

  test(
    "prints help without a selected Workspace",
    async () => {
      const run = await runDhw(["--help"]);

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("Deskohub Workspace administration");
    },
    dhwRunTimeout
  );

  test(
    "talks only to the selected Workspace",
    async () => {
      const workspace = startLocalWorkspace();

      const run = await runDhw(["api", "info", "--json"], {
        workspace: workspace.base,
      });

      expect(workspace.requests).toEqual(["/api/v1/cli/info"]);
      expect(run.egress).toEqual([]);
    },
    dhwRunTimeout
  );

  test(
    "reads credentials from the process-local store",
    async () => {
      const workspace = startLocalWorkspace();

      const run = await runDhw(["overview", "--json"], {
        workspace: workspace.base,
      });

      expect(run.exitCode).not.toBe(0);
      expect(run.stdout + run.stderr).toContain("Run dhw auth");
      expect(workspace.requests).toEqual([]);
    },
    dhwRunTimeout
  );

  test(
    "cannot reach the operating-system credential store",
    async () => {
      const workspace = startLocalWorkspace();

      const run = await runDhw(["overview", "--json"], {
        workspace: workspace.base,
        credentialStore: "system",
      });

      expect(run.exitCode).not.toBe(0);
      expect(run.stdout + run.stderr).toContain(
        "credential store is unavailable"
      );
      expect(workspace.requests).toEqual([]);
    },
    dhwRunTimeout
  );

  test(
    "routes requests beyond localhost to the egress trap",
    async () => {
      const previous = {
        https_proxy: process.env.https_proxy,
        no_proxy: process.env.no_proxy,
      };
      Object.assign(process.env, { https_proxy: "", no_proxy: "*" });

      try {
        const run = await runDhw(["api", "info", "--json"], {
          workspace: "https://workspace.example.test",
        });

        expect(run.exitCode).not.toBe(0);
        expect(run.egress).toEqual([
          "CONNECT workspace.example.test:443 HTTP/1.1",
        ]);
      } finally {
        for (const [name, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    },
    dhwRunTimeout
  );

  test(
    "refuses to select the production Workspace",
    async () => {
      await expect(
        runDhw(["version"], { workspace: productionOrigin.origin })
      ).rejects.toThrow("never select the production Workspace");
    },
    dhwRunTimeout
  );
});
