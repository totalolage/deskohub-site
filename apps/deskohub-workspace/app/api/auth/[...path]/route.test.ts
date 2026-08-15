import { expect, test } from "bun:test";
import { GET } from "./route";

test("fails closed when Neon Auth is not configured", async () => {
  const response = await GET(
    new Request("https://workspace.example.test/api/auth/get-session"),
    {
      params: Promise.resolve({ path: ["get-session"] }),
    }
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    code: "NEON_AUTH_NOT_CONFIGURED",
    error: "Authentication unavailable",
  });
});
