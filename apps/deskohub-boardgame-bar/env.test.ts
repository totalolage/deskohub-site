import { describe, expect, test } from "bun:test";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

setBoardgameTestEnv();

describe("env", () => {
  test("resolves the public domain from the deployment URL", async () => {
    const { env } = await import("./env");

    expect(env.NEXT_PUBLIC_DOMAIN).toBe(
      process.env.NEXT_PUBLIC_VERCEL_URL as string
    );
  });
});
