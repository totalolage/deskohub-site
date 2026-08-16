import { describe, expect, test } from "bun:test";
import { DELETE, GET, PATCH, POST } from "./route";

describe("Workspace Admin API route", () => {
  test("adapts the Effect API and disables caching", async () => {
    const response = await GET(
      new Request("https://workspace.deskohub.test/api/v1/cli/info")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      apiVersion: "v1",
      service: "deskohub-workspace",
    });
    expect(DELETE).toBe(POST);
    expect(PATCH).toBe(POST);
    expect(POST).not.toBe(GET);
  });

  test("keeps authenticated Nexi diagnostics on canonical and legacy paths", async () => {
    for (const path of [
      "/api/v1/cli/nexi/orders",
      "/api/v1/cli/nexi/operations",
      "/api/v1/cli/orders",
      "/api/v1/cli/operations",
    ]) {
      const response = await GET(
        new Request(`https://workspace.deskohub.test${path}`)
      );
      expect(response.status).toBe(401);
    }
  });
});
