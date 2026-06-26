import "@/shared/testing/workspace-test-env";
import { beforeEach, describe, expect, mock, test } from "bun:test";

const webhookSecret = "workspace-dotypos-webhook-secret";
const workspaceAvailabilityTag = "workspace-availability:all";
const revalidateTag = mock(() => undefined);

process.env.VERCEL_ENV = "production";
process.env.DOTYPOS_WEBHOOK_SECRET = webhookSecret;

mock.module("next/cache", () => ({
  cacheLife: mock(() => undefined),
  cacheTag: mock(() => undefined),
  revalidateTag,
}));

const request = (body: BodyInit, secret = webhookSecret) =>
  new Request(
    `https://workspace.example.test/api/webhooks/dotypos${secret ? `?secret=${secret}` : ""}`,
    {
      method: "POST",
      body,
    }
  );

const jsonRequest = (body: unknown, secret = webhookSecret) =>
  request(JSON.stringify(body), secret);

describe("Dotypos webhook route", () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidateTag.mockImplementation(() => undefined);
  });

  test("missing or invalid secret returns 401 without invalidation", async () => {
    const { POST } = await import("./route");

    for (const secret of ["", "wrong-secret"]) {
      const response = await POST(
        jsonRequest([{ id: "reservation-1" }], secret)
      );
      expect(response.status).toBe(401);
    }

    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("invalid payload returns 400 without invalidation", async () => {
    const { POST } = await import("./route");

    const response = await POST(request("not json"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid payload",
      message: "Failed to parse request body",
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("reservation record list expires workspace availability cache", async () => {
    const { POST } = await import("./route");

    const response = await POST(jsonRequest([{ id: "reservation-1" }]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      invalidatedTag: workspaceAvailabilityTag,
    });
    expect(revalidateTag).toHaveBeenCalledWith(workspaceAvailabilityTag, {
      expire: 0,
    });
  });

  test("invalidation failures return 500", async () => {
    const { POST } = await import("./route");
    revalidateTag.mockImplementation(() => {
      throw new Error("cache failed");
    });

    const response = await POST(jsonRequest([{ id: "reservation-1" }]));

    expect(response.status).toBe(500);
  });
});
