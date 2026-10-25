import { describe, expect, mock, test } from "bun:test";
import * as envModule from "@/env";
import { indexNowKey, indexNowKeyPathname } from "@/features/public-pages";

// The workspace env object is read once at import; route VERCEL_ENV through a
// switchable override so one file covers every deployment.
let vercelEnv = "production";
mock.module("@/env", () => ({
  ...envModule,
  env: new Proxy(envModule.env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? vercelEnv : Reflect.get(target, key),
  }),
}));

// Load the route through the key's pathname, so the test fails when the
// route folder and the key drift apart.
const { GET } = await import(`../${indexNowKeyPathname}/route`);

const keyFile = (deployment: string): Response => {
  vercelEnv = deployment;
  return GET();
};

describe("IndexNow key file", () => {
  test("serves the key as plain text in production", async () => {
    const response = keyFile("production");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await response.text()).toBe(indexNowKey);
  });

  for (const deployment of ["preview", "development"]) {
    test(`is not found in ${deployment}`, async () => {
      const response = keyFile(deployment);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    });
  }
});
