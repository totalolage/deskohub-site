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
});
