import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import {
  allocateLoopbackPort,
  waitForOwnedLoopbackServer,
  waitForOwnedLoopbackServerToStop,
} from "@/shared/testing/loopback-server";

const appRoot = resolve(import.meta.dir, "../../..");
const fixtureStartupTimeoutMs = 45_000;
const fixtureShutdownTimeoutMs = 5_000;
const fixtureBrowserTimeoutMs = 15_000;
const firstSubmittedCode = "SYNTHETIC-ORDINARY-CODE";
const secondSubmittedCode = "SYNTHETIC-NEXT-CODE";
type ReactEventHandler = (...args: never[]) => unknown;
type ReactEventHandlers = {
  readonly onChange?: ReactEventHandler;
  readonly onSubmit?: ReactEventHandler;
};
type WindowWithDiscountInput = Window & {
  __discountInput?: Element;
};

const fixtureFiles = (readinessMarker: string) => ({
  "app/fixture-ready/route.ts": `
const readinessMarker = ${JSON.stringify(readinessMarker)};

export async function GET() {
  return new Response(readinessMarker, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
`,
  "app/layout.tsx": `
import type { ReactNode } from "react";

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return <html lang="en-US"><body>{children}</body></html>;
}
`,
  "app/pay/page.tsx": `
import { CheckoutDiscountCodeForm } from "@/features/checkout/components/checkout-discount-code-form";
import { CheckoutPayShell } from "../pay-shell";

type PageProps = {
  readonly searchParams: Promise<{ readonly payState?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { payState = "before-referral" } = await searchParams;
  return (
    <main data-page-state={payState}>
      <CheckoutPayShell
        discountCodeForm={
          <CheckoutDiscountCodeForm
            enabled
            fieldError={false}
            locale="en-US"
            payStateToken={payState}
            referralApplied={payState === "after-referral"}
          />
        }
      />
    </main>
  );
}
`,
  "app/pay-shell.tsx": `
"use client";

import { useEffect, useState, type ReactNode } from "react";

export function CheckoutPayShell({ discountCodeForm }: { readonly discountCodeForm: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <section data-checkout-pay-shell data-hydrated={hydrated ? "true" : "false"}>{discountCodeForm}</section>;
}
`,
  "next.config.mjs": `
const nextConfig = { experimental: { externalDir: true }, reactCompiler: true };
export default nextConfig;
`,
  "package.json": JSON.stringify(
    { private: true, type: "module", scripts: { dev: "next dev" } },
    null,
    2
  ),
  "test-action.ts": `
"use server";

import { RedirectType, redirect } from "next/navigation";

export async function applyDiscountCodeForm(
  _locale: string,
  payStateToken: string,
  formData: FormData
) {
  const submittedCode = formData.get("submittedCode");
  if (payStateToken === "before-referral" && submittedCode === "SYNTHETIC-ORDINARY-CODE") {
    redirect("/pay?payState=after-referral", RedirectType.replace);
  }

  if (submittedCode !== "SYNTHETIC-NEXT-CODE") {
    redirect("/pay?payState=after-second-submit-wrong-data", RedirectType.replace);
  }

  redirect(
    payStateToken === "after-referral"
      ? "/pay?payState=after-second-submit-fresh"
      : "/pay?payState=after-second-submit-wrong-token",
    RedirectType.replace
  );
}
`,
  "test-env.ts": `
export const env = {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined,
  NEXT_PUBLIC_POSTHOG_HOST: undefined,
} as const;
`,
  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        allowJs: true,
        baseUrl: ".",
        esModuleInterop: true,
        isolatedModules: true,
        jsx: "preserve",
        lib: ["dom", "dom.iterable", "esnext"],
        module: "esnext",
        moduleResolution: "bundler",
        noEmit: true,
        paths: {
          "@/env": ["./test-env.ts"],
          "@/features/checkout/actions/apply-discount-code": [
            "./test-action.ts",
          ],
          "@/*": ["./source/*"],
        },
        plugins: [{ name: "next" }],
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    },
    null,
    2
  ),
});

const writeFixture = async (fixtureRoot: string, readinessMarker: string) => {
  const files = fixtureFiles(readinessMarker);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(fixtureRoot, relativePath);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }

  await mkdir(join(fixtureRoot, "source"), { recursive: true });
  await symlink(
    resolve(appRoot, "features"),
    join(fixtureRoot, "source/features"),
    "dir"
  );
  await symlink(
    resolve(appRoot, "shared"),
    join(fixtureRoot, "source/shared"),
    "dir"
  );
  await symlink(
    resolve(appRoot, "node_modules"),
    join(fixtureRoot, "node_modules"),
    "dir"
  );
};

const waitForReactHandler = async (
  page: Page,
  selector: string,
  handler: "onChange" | "onSubmit"
) => {
  await page.waitForFunction(
    ({ selector: targetSelector, handler: targetHandler }) => {
      const element = document.querySelector(targetSelector);
      const reactPropsKey = element
        ? Object.keys(element).find((key) => key.startsWith("__reactProps$"))
        : undefined;
      const props = reactPropsKey
        ? (Reflect.get(element, reactPropsKey) as ReactEventHandlers)
        : undefined;

      return targetHandler === "onChange"
        ? props?.onChange !== undefined
        : props?.onSubmit !== undefined;
    },
    { selector, handler },
    { timeout: fixtureBrowserTimeoutMs }
  );
};

const waitForOwnedChildExit = async (
  childExit: Promise<unknown>,
  timeoutMs: number
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const didExit = await Promise.race([
    childExit.then(() => true),
    new Promise<boolean>((resolveExit) => {
      timer = setTimeout(() => resolveExit(false), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return didExit;
};

test("clears the ordinary code after a fresh referral state in the compiled browser form", {
  timeout: 120_000,
}, async () => {
  const port = await allocateLoopbackPort();
  const readinessMarker = randomUUID();
  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "workspace-discount-code-reset-")
  );
  const fixtureUrl = `http://127.0.0.1:${port}`;
  const readinessUrl = `${fixtureUrl}/fixture-ready`;
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let serverExit: Promise<number> | undefined;
  let serverExitCode: number | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let teardownError: Error | undefined;

  try {
    await writeFixture(fixtureRoot, readinessMarker);
    const nextCli = resolve(appRoot, "node_modules/next/dist/bin/next");
    server = Bun.spawn(
      [
        process.execPath,
        nextCli,
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: fixtureRoot,
        env: {
          HOME: process.env.HOME ?? "/tmp",
          BUN_OPTIONS: "--no-env-file",
          NEXT_TELEMETRY_DISABLED: "1",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          TMPDIR: process.env.TMPDIR ?? tmpdir(),
        },
        stderr: "ignore",
        stdin: "ignore",
        stdout: "ignore",
      }
    );
    serverExit = server.exited.then((code) => {
      serverExitCode = code;
      return code;
    });

    await waitForOwnedLoopbackServer({
      exitCode: () => serverExitCode,
      marker: readinessMarker,
      readyUrl: readinessUrl,
      timeoutMs: fixtureStartupTimeoutMs,
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(fixtureBrowserTimeoutMs);
    page.setDefaultNavigationTimeout(fixtureBrowserTimeoutMs);

    await page.goto(`${fixtureUrl}/pay?payState=before-referral`, {
      waitUntil: "load",
    });
    await page
      .locator('[data-checkout-pay-shell][data-hydrated="true"]')
      .waitFor();

    const input = page.locator(
      '#checkout-discount-code-form input[name="submittedCode"]'
    );
    await input.waitFor({ state: "visible" });
    await waitForReactHandler(
      page,
      '#checkout-discount-code-form input[name="submittedCode"]',
      "onChange"
    );
    await waitForReactHandler(page, "#checkout-discount-code-form", "onSubmit");
    await input.fill(firstSubmittedCode);
    await input.evaluate((element) => {
      (window as WindowWithDiscountInput).__discountInput = element;
    });

    await Promise.all([
      page.waitForURL(
        (url) => url.searchParams.get("payState") === "after-referral"
      ),
      input.press("Enter"),
    ]);
    await page.locator('main[data-page-state="after-referral"]').waitFor();
    await page.waitForFunction(
      () => {
        const input = document.querySelector<HTMLInputElement>(
          '#checkout-discount-code-form input[name="submittedCode"]'
        );
        return input !== null && input.value === "";
      },
      undefined,
      { timeout: fixtureBrowserTimeoutMs }
    );

    const sameInputNode = await input.evaluate((element) =>
      Object.is(element, (window as WindowWithDiscountInput).__discountInput)
    );
    const inputIsEmpty = await input.evaluate(
      (element) => (element as HTMLInputElement).value === ""
    );
    const referralNoticeIsPresent =
      (await page.locator("[data-checkout-referral-applied]").count()) === 1;

    expect(sameInputNode).toBe(true);
    expect(inputIsEmpty).toBe(true);
    expect(referralNoticeIsPresent).toBe(true);

    await input.fill(secondSubmittedCode);
    await Promise.all([
      page.waitForURL((url) =>
        url.searchParams.get("payState")?.startsWith("after-second-submit-")
      ),
      input.press("Enter"),
    ]);

    const freshTokenWasUsed =
      new URL(page.url()).searchParams.get("payState") ===
      "after-second-submit-fresh";
    expect(freshTokenWasUsed).toBe(true);
  } finally {
    try {
      await browser?.close();
    } catch {
      teardownError = new Error("owned browser fixture did not close cleanly");
    }
    try {
      if (server && serverExit) {
        if (serverExitCode === undefined) server.kill("SIGTERM");
        let exited = await waitForOwnedChildExit(
          serverExit,
          fixtureShutdownTimeoutMs
        );
        if (!exited) {
          server.kill("SIGKILL");
          exited = await waitForOwnedChildExit(
            serverExit,
            fixtureShutdownTimeoutMs
          );
        }
        if (!exited)
          teardownError ??= new Error(
            "owned Next fixture child did not exit after SIGKILL"
          );
      }
    } catch {
      teardownError ??= new Error("owned Next fixture child did not stop");
    }
    try {
      await waitForOwnedLoopbackServerToStop({
        marker: readinessMarker,
        readyUrl: readinessUrl,
        timeoutMs: fixtureShutdownTimeoutMs,
      });
    } catch {
      teardownError ??= new Error(
        "owned Next fixture marker did not disappear"
      );
    }
    try {
      await rm(fixtureRoot, { force: true, recursive: true });
    } catch {
      teardownError ??= new Error(
        "owned Next fixture directory was not removed"
      );
    }
  }
  if (teardownError) throw teardownError;
});
