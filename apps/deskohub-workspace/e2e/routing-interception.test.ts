import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const routingPort = 3162;
const syntheticOrderId = "synthetic-routing-reservation";

type FixtureMode = "global" | "account";

const fixtureFiles = (mode: FixtureMode): Readonly<Record<string, string>> => {
  const globalModalFiles = {
    "app/[locale]/@modal/(.)reservation/status/[orderId]/page.tsx":
      modalStatusPage,
    "app/[locale]/@modal/[...not-found]/page.tsx": nullModalPage,
    "app/[locale]/@modal/default.tsx": nullModalPage,
    "app/[locale]/@modal/page.tsx": nullModalPage,
  };
  const accountModalFiles = {
    "app/[locale]/(full-header)/account/@modal/(..)reservation/status/[orderId]/page.tsx":
      modalStatusPage,
    "app/[locale]/(full-header)/account/@modal/[...not-found]/page.tsx":
      nullModalPage,
    "app/[locale]/(full-header)/account/@modal/default.tsx": nullModalPage,
    "app/[locale]/(full-header)/account/@modal/page.tsx": nullModalPage,
  };

  return {
    "app/[locale]/(full-header)/account/page.tsx": accountPage,
    "app/[locale]/(full-header)/layout.tsx": fullHeaderLayout,
    "app/[locale]/(minimal-header)/checkout/pay/page.tsx": checkoutPayPage,
    "app/[locale]/(minimal-header)/layout.tsx": minimalHeaderLayout,
    "app/[locale]/(minimal-header)/reservation/status/[orderId]/page.tsx":
      canonicalStatusPage,
    "app/[locale]/layout.tsx": localeLayout(mode),
    "app/layout.tsx": rootLayout,
    instrumentation: "export function register() {}",
    "next.config.mjs": nextConfig,
    "package.json": packageJson,
    ...(mode === "global" ? globalModalFiles : accountModalFiles),
    ...(mode === "account"
      ? {
          "app/[locale]/(full-header)/account/layout.tsx": accountLayout,
        }
      : {}),
  };
};

const packageJson = JSON.stringify(
  {
    private: true,
    scripts: { dev: "next dev" },
    type: "module",
  },
  null,
  2
);

const nextConfig = "const nextConfig = {}; export default nextConfig;";

const rootLayout = `
import type { ReactNode } from "react";

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`;

const localeLayout = (mode: FixtureMode) => `
import type { ReactNode } from "react";

type LocaleLayoutProps = {
  readonly children: ReactNode;
  ${mode === "global" ? "readonly modal: ReactNode;" : ""}
};

export default function LocaleLayout({
  children,
  ${mode === "global" ? "modal," : ""}
}: LocaleLayoutProps) {
  return <>{children}${mode === "global" ? "{modal}" : ""}</>;
}
`;

const fullHeaderLayout = `
import type { ReactNode } from "react";

export default function FullHeaderLayout({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
`;

const minimalHeaderLayout = fullHeaderLayout;

const accountLayout = `
import type { ReactNode } from "react";

export default function AccountLayout({
  children,
  modal,
}: {
  readonly children: ReactNode;
  readonly modal: ReactNode;
}) {
  return <>{children}{modal}</>;
}
`;

const accountPage = `
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const statusHref = "/en-US/reservation/status/${syntheticOrderId}";

export default function AccountPage() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <main data-hydrated={hydrated ? "true" : "false"} data-testid="account-page">
      <h1>Account</h1>
      <Link href={statusHref} prefetch={false}>Reservation details</Link>
      <Link href="/en-US/checkout/pay" prefetch={false}>Leave account</Link>
    </main>
  );
}
`;

const checkoutPayPage = `
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const statusHref = "/en-US/reservation/status/${syntheticOrderId}";

export default function CheckoutPayPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <main data-hydrated={hydrated ? "true" : "false"} data-testid="checkout-page">
      <h1>Checkout payment</h1>
      <button type="button" onClick={() => router.push(statusHref)}>
        Complete checkout
      </button>
    </main>
  );
}
`;

const canonicalStatusPage = `
type StatusPageProps = {
  readonly params: Promise<{ readonly orderId: string }>;
};

export default async function CanonicalStatusPage({ params }: StatusPageProps) {
  const { orderId } = await params;
  return (
    <main data-testid="canonical-status-page">
      <h1>Reservation status</h1>
      <p>{orderId}</p>
      <a id="status-cta" href="/en-US/checkout/pay">Book again</a>
    </main>
  );
}
`;

const modalStatusPage = `
"use client";

import { useRouter } from "next/navigation";

export default function ModalStatusPage() {
  const router = useRouter();
  return (
    <div data-testid="reservation-status-modal" role="dialog">
      <h1>Reservation status</h1>
      <p>Reservation details</p>
      <button type="button" onClick={() => router.back()}>Close</button>
    </div>
  );
}
`;

const nullModalPage =
  "export default function ModalFallback() { return null; }";

const writeFixture = async (root: string, mode: FixtureMode) => {
  for (const [relativePath, contents] of Object.entries(fixtureFiles(mode))) {
    const filePath = join(root, relativePath);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }
};

const waitForServer = async (url: string, exited: { value: boolean }) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (exited.value) throw new Error("routing fixture server exited early");
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // The Next development server is still compiling or binding its port.
    }
    await Bun.sleep(100);
  }
  throw new Error("routing fixture server did not become ready");
};

const waitForServerToStop = async (url: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("routing fixture server did not release its port");
};

const runFixture = async (
  mode: FixtureMode,
  browser: Awaited<ReturnType<typeof chromium.launch>>
) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "deskohub-routing-next-"));
  const serverUrl = `http://localhost:${routingPort}`;
  const accountUrl = `${serverUrl}/en-US/account`;
  const checkoutUrl = `${serverUrl}/en-US/checkout/pay`;
  const statusUrl = `${serverUrl}/en-US/reservation/status/${syntheticOrderId}`;
  const exited = { value: false };
  const nextCli = resolve(
    import.meta.dir,
    "../node_modules/next/dist/bin/next"
  );

  await writeFixture(fixtureRoot, mode);
  await symlink(
    resolve(import.meta.dir, "../node_modules"),
    join(fixtureRoot, "node_modules"),
    "dir"
  );
  const server = Bun.spawn(
    [
      process.execPath,
      nextCli,
      "dev",
      "--webpack",
      "--port",
      String(routingPort),
    ],
    {
      cwd: fixtureRoot,
      env: {
        HOME: process.env.HOME ?? "/tmp",
        NEXT_TELEMETRY_DISABLED: "1",
        PATH: process.env.PATH ?? "",
      },
      stderr: "ignore",
      stdout: "ignore",
    }
  );
  void server.exited.then(() => {
    exited.value = true;
  });

  try {
    await waitForServer(`${serverUrl}/en-US/account`, exited);
    const page = await browser.newPage();
    try {
      await page.goto(accountUrl, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Account" }).waitFor();
      await page
        .locator('[data-testid="account-page"][data-hydrated="true"]')
        .waitFor();

      await Promise.all([
        page.waitForURL(statusUrl),
        page.getByRole("link", { name: "Reservation details" }).click(),
      ]);
      await page.getByRole("dialog").waitFor();
      expect(await page.locator("#status-cta").count()).toBe(0);

      await Promise.all([
        page.waitForURL(accountUrl),
        page.getByRole("dialog").getByRole("button", { name: "Close" }).click(),
      ]);
      expect(await page.getByRole("dialog").count()).toBe(0);

      await page.getByRole("link", { name: "Reservation details" }).click();
      await page.waitForURL(statusUrl);
      await page.getByRole("dialog").waitFor();
      await page.goBack();
      await page.waitForURL(accountUrl);
      expect(await page.getByRole("dialog").count()).toBe(0);
      await page.goForward();
      await page.waitForURL(statusUrl);
      await page.getByRole("dialog").waitFor();

      await page.goto(checkoutUrl, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Checkout payment" }).waitFor();
      await page
        .locator('[data-testid="checkout-page"][data-hydrated="true"]')
        .waitFor();
      await Promise.all([
        page.waitForURL(statusUrl),
        page.getByRole("button", { name: "Complete checkout" }).click(),
      ]);

      if (mode === "global") {
        await page.getByRole("dialog").waitFor();
        expect(await page.locator("#status-cta").count()).toBe(0);
      } else {
        await page.getByTestId("canonical-status-page").waitFor();
        expect(await page.getByRole("dialog").count()).toBe(0);
        expect(await page.locator("#status-cta").count()).toBe(1);
      }

      await page.reload({ waitUntil: "load" });
      expect(await page.getByRole("dialog").count()).toBe(0);
      expect(await page.locator("#status-cta").count()).toBe(1);

      await page.goto(accountUrl, { waitUntil: "load" });
      await page
        .locator('[data-testid="account-page"][data-hydrated="true"]')
        .waitFor();
      await page.getByRole("link", { name: "Reservation details" }).click();
      await page.waitForURL(statusUrl);
      await page.getByRole("dialog").waitFor();
      await page.goBack();
      await page.waitForURL(accountUrl);
      await page.getByRole("link", { name: "Leave account" }).click();
      await page.waitForURL(checkoutUrl);
      expect(await page.getByRole("dialog").count()).toBe(0);
    } finally {
      await page.close();
    }
  } finally {
    server.kill();
    await server.exited;
    await waitForServerToStop(`${serverUrl}/en-US/account`);
    await rm(fixtureRoot, { force: true, recursive: true });
  }
};

test("isolates global and account-scoped interception behavior in actual Next routing", {
  timeout: 120_000,
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // The global variant mirrors a608fbda2: checkout-origin soft navigation is
    // incorrectly intercepted and loses the canonical page actions.
    await runFixture("global", browser);
    // The account variant is the production ownership: only account-origin
    // navigation receives the modal presentation.
    await runFixture("account", browser);
  } finally {
    await browser.close();
  }
});
