import { beforeEach, describe, expect, mock, test } from "bun:test";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { dotyposTags } from "@/shared/utils/cache-tags";

const webhookSecret = "00000000-0000-4000-8000-000000000000";

const revalidateTag = mock(() => undefined);

mock.module("next/cache", () => ({
  revalidateTag,
}));

const productPayload = (overrides: Record<string, unknown> = {}) => ({
  productid: 123,
  categoryid: 456,
  name: "Product",
  created: 1000,
  versiondate: 1000,
  deleted: 0,
  ...overrides,
});

const request = (body: unknown, secret = webhookSecret) =>
  new Request(
    `https://bar.example.test/api/webhooks/products${secret ? `?secret=${secret}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );

describe("products webhook route", () => {
  beforeEach(() => {
    setBoardgameTestEnv();
    revalidateTag.mockClear();
    revalidateTag.mockImplementation(() => undefined);
  });

  test("missing or invalid secret returns 401", async () => {
    const { POST } = await import("./route");

    for (const secret of ["", "wrong-secret"]) {
      const response = await POST(request([productPayload()], secret));
      expect(response.status).toBe(401);
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("development accepts product webhooks without a secret", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalVercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
    Object.assign(process.env, {
      NODE_ENV: "development",
      NEXT_PUBLIC_VERCEL_ENV: "development",
    });
    const { POST } = await import("./route");

    try {
      const response = await POST(request([productPayload()], ""));

      expect(response.status).toBe(200);
      expect(revalidateTag).toHaveBeenCalledWith(dotyposTags.menu.all(), "max");
    } finally {
      if (originalNodeEnv === undefined) {
        Reflect.deleteProperty(process.env, "NODE_ENV");
      } else {
        Object.assign(process.env, { NODE_ENV: originalNodeEnv });
      }
      if (originalVercelEnv === undefined) {
        Reflect.deleteProperty(process.env, "NEXT_PUBLIC_VERCEL_ENV");
      } else {
        process.env.NEXT_PUBLIC_VERCEL_ENV = originalVercelEnv;
      }
    }
  });

  test("invalid payload returns 400", async () => {
    const { POST } = await import("./route");

    const response = await POST(request({ nope: true }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Invalid payload",
      message: "Invalid product payload format",
    });
    expect(body).toHaveProperty("issues", expect.any(String));
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("valid payload invalidates menu, category, and product tags", async () => {
    const { POST } = await import("./route");

    const response = await POST(request([productPayload()]));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        invalidatedTags: [
          dotyposTags.menu.all(),
          dotyposTags.menu.byCategory("456"),
          dotyposTags.menu.byProduct("123"),
        ],
      },
    });
    expect(revalidateTag).toHaveBeenCalledWith(dotyposTags.menu.all(), "max");
    expect(revalidateTag).toHaveBeenCalledWith(
      dotyposTags.menu.byCategory("456"),
      "max"
    );
    expect(revalidateTag).toHaveBeenCalledWith(
      dotyposTags.menu.byProduct("123"),
      "max"
    );
  });

  test("processing failures are acknowledged without retry", async () => {
    const { POST } = await import("./route");
    revalidateTag.mockImplementation(() => {
      throw new Error("cache failed");
    });

    const response = await POST(request([productPayload()]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: false,
      error: "Internal processing error",
    });
  });
});
