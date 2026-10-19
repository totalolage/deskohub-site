import { expect, test } from "bun:test";
import { chromium, type Page, type Request } from "@playwright/test";
import { withNextAppFixture } from "@/shared/testing/next-app-fixture.test-utils";

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

const fixtureFiles = {
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

test("clears the ordinary code after a fresh referral state in the compiled browser form", {
  timeout: 120_000,
}, async () => {
  await withNextAppFixture(
    {
      files: fixtureFiles,
      name: "workspace-discount-code-reset",
      paths: {
        "@/env": ["./test-env.ts"],
        "@/features/checkout/actions/apply-discount-code": ["./test-action.ts"],
      },
    },
    async ({ exitCode, url: fixtureUrl }) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(fixtureBrowserTimeoutMs);
        page.setDefaultNavigationTimeout(fixtureBrowserTimeoutMs);

        const resourceCounts = {
          response: {
            document: 0,
            script: 0,
            stylesheet: 0,
            image: 0,
            font: 0,
            fetch: 0,
            other: 0,
          },
          finished: {
            document: 0,
            script: 0,
            stylesheet: 0,
            image: 0,
            font: 0,
            fetch: 0,
            other: 0,
          },
          failed: {
            document: 0,
            script: 0,
            stylesheet: 0,
            image: 0,
            font: 0,
            fetch: 0,
            other: 0,
          },
        };
        let mainDocumentStatus = 0;
        let pageErrorCount = 0;
        const resourceClass = (request: Request) => {
          switch (request.resourceType()) {
            case "document":
              return "document";
            case "script":
              return "script";
            case "stylesheet":
              return "stylesheet";
            case "image":
              return "image";
            case "font":
              return "font";
            case "fetch":
            case "xhr":
              return "fetch";
            default:
              return "other";
          }
        };
        page.on("response", (response) => {
          const request = response.request();
          resourceCounts.response[resourceClass(request)] += 1;
          if (request.isNavigationRequest()) {
            try {
              if (request.frame() === page.mainFrame()) {
                mainDocumentStatus = response.status();
              }
            } catch {
              // A diagnostic observer must not change the browser interaction.
            }
          }
        });
        page.on("requestfinished", (request) => {
          resourceCounts.finished[resourceClass(request)] += 1;
        });
        page.on("requestfailed", (request) => {
          resourceCounts.failed[resourceClass(request)] += 1;
        });
        page.on("pageerror", () => {
          pageErrorCount += 1;
        });

        try {
          await page.goto(`${fixtureUrl}/pay?payState=before-referral`, {
            waitUntil: "load",
          });
        } catch (error) {
          process.stderr.write(
            `e2e.checkout.initial_navigation ${JSON.stringify({
              code: "navigation_failed",
              mainDocumentStatus,
              responseCounts: resourceCounts.response,
              finishedCounts: resourceCounts.finished,
              failedCounts: resourceCounts.failed,
              pageErrorCount,
              ownedServerExitCode: exitCode() ?? -1,
            })}\n`
          );
          throw error;
        }
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
        await waitForReactHandler(
          page,
          "#checkout-discount-code-form",
          "onSubmit"
        );
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
          Object.is(
            element,
            (window as WindowWithDiscountInput).__discountInput
          )
        );
        const inputIsEmpty = await input.evaluate(
          (element) => (element as HTMLInputElement).value === ""
        );
        const referralNoticeIsPresent =
          (await page.locator("[data-checkout-referral-applied]").count()) ===
          1;

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
        await browser.close();
      }
    }
  );
});
