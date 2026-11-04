import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";

setBoardgameTestEnv();
mock.module("server-only", () => ({}));

type LayoutEnv = Pick<
  typeof import("@/env").env,
  "NEXT_PUBLIC_GTM_ID" | "NEXT_PUBLIC_NODE_ENV" | "NEXT_PUBLIC_VERCEL_ENV"
>;

let GoogleTagManager: typeof import("@next/third-parties/google").GoogleTagManager;
let Analytics: typeof import("@vercel/analytics/next").Analytics;
let env: typeof import("@/env").env;
let baseLocale: typeof import("@/features/i18n").baseLocale;
let RootLayout: typeof import("./rootLayout").default;
let initialEnv: LayoutEnv;

beforeAll(async () => {
  ({ GoogleTagManager } = await import("@next/third-parties/google"));
  ({ Analytics } = await import("@vercel/analytics/next"));
  ({ env } = await import("@/env"));
  ({ baseLocale } = await import("@/features/i18n"));
  ({ default: RootLayout } = await import("./rootLayout"));
  initialEnv = {
    NEXT_PUBLIC_GTM_ID: env.NEXT_PUBLIC_GTM_ID,
    NEXT_PUBLIC_NODE_ENV: env.NEXT_PUBLIC_NODE_ENV,
    NEXT_PUBLIC_VERCEL_ENV: env.NEXT_PUBLIC_VERCEL_ENV,
  };
});

const setLayoutEnv = (overrides: Partial<LayoutEnv>) => {
  Object.assign(env, overrides);
};

afterEach(() => {
  Object.assign(env, initialEnv);
});

describe("RootLayout", () => {
  test("loads Google Tag Manager with the configured container", async () => {
    setLayoutEnv({ NEXT_PUBLIC_GTM_ID: "GTM-TEST" });

    const layout = await RootLayout({ locale: "en-US", children: null });

    expect(layout.props.lang).toBe("en-US");
    expect(
      findElementsOfType(layout, GoogleTagManager).map(
        (element) => element.props.gtmId
      )
    ).toEqual(["GTM-TEST"]);
  });

  test("leaves Google Tag Manager out without a container, in the base locale", async () => {
    setLayoutEnv({ NEXT_PUBLIC_GTM_ID: undefined });

    const layout = await RootLayout({ children: null });

    expect(layout.props.lang).toBe(baseLocale);
    expect(findElementsOfType(layout, GoogleTagManager)).toEqual([]);
  });

  test("reports analytics in development mode on development deployments", async () => {
    setLayoutEnv({
      NEXT_PUBLIC_NODE_ENV: "production",
      NEXT_PUBLIC_VERCEL_ENV: "development",
    });

    const [analytics] = findElementsOfType(
      await RootLayout({ children: null }),
      Analytics
    );

    expect(analytics?.props.mode).toBe("development");
  });

  test("reports analytics in production mode on production deployments", async () => {
    setLayoutEnv({
      NEXT_PUBLIC_NODE_ENV: "production",
      NEXT_PUBLIC_VERCEL_ENV: "production",
    });

    const [analytics] = findElementsOfType(
      await RootLayout({ children: null }),
      Analytics
    );

    expect(analytics?.props.mode).toBe("production");
  });
});
