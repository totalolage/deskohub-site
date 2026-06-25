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

const request = (body: unknown, secret = webhookSecret) =>
  new Request(
    `https://workspace.example.test/api/webhooks/dotypos${secret ? `?secret=${secret}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

describe("Dotypos webhook route", () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidateTag.mockImplementation(() => undefined);
  });

  test("missing or invalid secret returns 401 without invalidation", async () => {
    const { POST } = await import("./route");

    for (const secret of ["", "wrong-secret"]) {
      const response = await POST(
        request({ payloadEntity: "RESERVATION" }, secret)
      );
      expect(response.status).toBe(401);
    }

    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("invalid payload returns 400 without invalidation", async () => {
    const { POST } = await import("./route");

    const response = await POST(request({ nope: true }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid payload",
      message: "Invalid Dotypos webhook payload",
    });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("non-reservation payloads are ignored", async () => {
    const { POST } = await import("./route");

    const response = await POST(request({ payloadEntity: "PRODUCT" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ignored: true });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("reservation payload expires workspace availability cache", async () => {
    const { POST } = await import("./route");

    const response = await POST(request({ payloadEntity: "RESERVATION" }));

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

    const response = await POST(request({ payloadEntity: "RESERVATION" }));

    expect(response.status).toBe(500);
  });
});
