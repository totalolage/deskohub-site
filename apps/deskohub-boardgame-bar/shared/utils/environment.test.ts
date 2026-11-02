import { afterEach, describe, expect, test } from "bun:test";
import { isDev, isLocalHostname } from "./environment";

const production = { nodeEnv: "production", vercelEnv: "production" };
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
};

const setEnv = (name: keyof typeof originalEnv, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else Object.assign(process.env, { [name]: value });
};

afterEach(() => {
  setEnv("NODE_ENV", originalEnv.NODE_ENV);
  setEnv("NEXT_PUBLIC_VERCEL_ENV", originalEnv.NEXT_PUBLIC_VERCEL_ENV);
  Reflect.deleteProperty(globalThis, "window");
});

describe("isLocalHostname", () => {
  test.each(["localhost", "127.0.0.1", "192.168.1.20", "10.0.0.5"])(
    "treats %s as local",
    (hostname) => {
      expect(isLocalHostname(hostname)).toBe(true);
    }
  );

  test.each([undefined, "", "bar.example.test", "172.16.0.1", "110.0.0.1"])(
    "treats %p as remote",
    (hostname) => {
      expect(isLocalHostname(hostname)).toBe(false);
    }
  );
});

describe("isDev", () => {
  test("is true in a development Node or Vercel environment", () => {
    expect(isDev({ ...production, nodeEnv: "development" })).toBe(true);
    expect(isDev({ ...production, vercelEnv: "development" })).toBe(true);
  });

  test("is true on a local hostname and false on a public one", () => {
    expect(isDev({ ...production, hostname: "localhost" })).toBe(true);
    expect(isDev({ ...production, hostname: "bar.example.test" })).toBe(false);
  });

  test("reads the Node and Vercel environments from the process", () => {
    setEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    setEnv("NODE_ENV", "development");
    expect(isDev()).toBe(true);

    setEnv("NODE_ENV", "production");
    expect(isDev()).toBe(false);

    setEnv("NEXT_PUBLIC_VERCEL_ENV", "development");
    expect(isDev()).toBe(true);
  });

  test("reads the browser's hostname when none is given", () => {
    Object.assign(globalThis, {
      window: { location: { hostname: "10.1.2.3" } },
    });

    expect(isDev(production)).toBe(true);
    expect(isDev({ ...production, hostname: "bar.example.test" })).toBe(false);
  });
});
