/**
 * Layout-metrics regression for the discount-admin valid-from/valid-until
 * DateTimeInput pair. It bundles the real creation dialogs with the real
 * Tailwind CSS, serves them statically, and measures real chromium layout at
 * narrow width: the two fields must share one row, split the wrapper content
 * width into two equal halves, stay inside the wrapper bounds, and keep the
 * date-trigger text from overflowing. It also captures evidence screenshots
 * at 390/768/1280 for both dialog variants and locales.
 *
 * Usage:
 *   bun apps/deskohub-workspace/scripts/discounts-admin-narrow-pair/run.ts \
 *     --out /tmp/opencode/pr427-date-inputs-evidence/round6
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "@playwright/test";
import {
  resolveModulePath,
  transformGlobalsCss,
} from "../shared/app-module-build";

const appRoot = resolve(import.meta.dir, "../..");
const browserEntryPath = join(import.meta.dir, "browser-entry.tsx");
const nextNavigationStubPath = resolve(
  import.meta.dir,
  "../account-visual/stubs/next-navigation.ts"
);
const serverOnlyStubPath = resolve(
  import.meta.dir,
  "../account-visual/stubs/server-only-fail-closed.ts"
);
const globalsCssPath = join(appRoot, "app/globals.css");
const narrowViewport = { width: 390, height: 844 } as const;
const evidenceDefault = "/tmp/opencode/pr427-date-inputs-evidence/round6";
const locales = ["en-US", "cs-CZ"] as const;
const dialogs = ["code", "voucher"] as const;
const captureWidths = [390, 768, 1280] as const;

const readArg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const outputRoot = resolve(readArg("out") ?? evidenceDefault);
const buildRoot = join(outputRoot, ".build");
const actionsStubPath = join(buildRoot, "actions-stub.ts");
const envStubPath = join(buildRoot, "env-stub.ts");

const createBuildPlugin = (): Bun.BunPlugin => ({
  name: "discounts-admin-narrow-pair-build",
  setup(build) {
    const exactAliases = new Map<string, string>([
      ["next/navigation", nextNavigationStubPath],
      ["server-only", serverOnlyStubPath],
      ["@/features/discounts/admin/actions", actionsStubPath],
      ["@/env", envStubPath],
    ]);
    build.onResolve({ filter: /^\.\/actions$/ }, (args) =>
      args.resolveDir.startsWith(join(appRoot, "features/discounts/admin"))
        ? { path: actionsStubPath }
        : undefined
    );
    build.onResolve({ filter: /^@\// }, async (args) => ({
      path:
        exactAliases.get(args.path) ??
        (await resolveModulePath(join(appRoot, args.path.slice(2)), args.path)),
    }));
    build.onResolve({ filter: /^next\/navigation$|^server-only$/ }, (args) => {
      const replacement = exactAliases.get(args.path);
      return replacement ? { path: replacement } : undefined;
    });
    build.onLoad({ filter: /\/app\/globals\.css$/ }, async (args) => {
      if (resolve(args.path) !== globalsCssPath) return undefined;
      return await transformGlobalsCss(globalsCssPath, appRoot);
    });
  },
});

const pairMetricsScript = (): PairMetrics => {
  const wrapper = (() => {
    let element = document.querySelector('input[name="validFrom"]');
    if (!element) return null;
    while (element.parentElement) {
      element = element.parentElement;
      if (
        element.classList.contains("grid") &&
        element.querySelector('input[name="validUntil"]') &&
        element.querySelector('input[name="validFrom"]')
      ) {
        return element;
      }
    }
    return null;
  })();
  if (!wrapper) return { error: "missing pair wrapper" };
  const fieldContainer = (inputName: string) => {
    let element: Element = wrapper.querySelector(
      'input[name="' + inputName + '"]'
    )!;
    while (element.parentElement !== wrapper) element = element.parentElement!;
    return element;
  };
  const measureField = (inputName: string): FieldMetrics => {
    const container = fieldContainer(inputName);
    const rect = container.getBoundingClientRect();
    const trigger = container.querySelector('button[aria-haspopup="dialog"]');
    const triggerRect = trigger ? trigger.getBoundingClientRect() : null;
    return {
      name: inputName,
      top: rect.top,
      width: rect.width,
      right: rect.right,
      triggerTextOverflow:
        trigger === null ? null : trigger.scrollWidth - trigger.clientWidth,
      triggerText: trigger === null ? null : (trigger.textContent ?? "").trim(),
      triggerRight: triggerRect === null ? null : triggerRect.right,
      triggerWidth: triggerRect === null ? null : triggerRect.width,
      containerRight: rect.right,
      triggerWithinBounds:
        triggerRect === null ? null : triggerRect.right <= rect.right + 0.5,
    };
  };
  const wrapperStyle = getComputedStyle(wrapper);
  const wrapperRect = wrapper.getBoundingClientRect();
  const documentElement = document.documentElement;
  return {
    viewportWidth: window.innerWidth,
    wrapperWidth: wrapperRect.width,
    wrapperRight: wrapperRect.right,
    gap: Number.parseFloat(wrapperStyle.columnGap) || 0,
    halfWidthExpected:
      (wrapper.clientWidth - (Number.parseFloat(wrapperStyle.columnGap) || 0)) /
      2,
    documentOverflowPx: Math.max(
      0,
      (documentElement.scrollWidth || 0) - (documentElement.clientWidth || 0)
    ),
    from: measureField("validFrom"),
    until: measureField("validUntil"),
  };
};

type FieldMetrics = {
  readonly name: string;
  readonly top: number;
  readonly width: number;
  readonly right: number;
  readonly triggerRight: number | null;
  readonly triggerWidth: number | null;
  readonly containerRight: number;
  readonly triggerTextOverflow: number | null;
  readonly triggerText: string | null;
  readonly triggerWithinBounds: boolean | null;
};

type PairLayoutMetrics = {
  readonly viewportWidth: number;
  readonly wrapperWidth: number;
  readonly wrapperRight: number;
  readonly gap: number;
  readonly halfWidthExpected: number;
  readonly documentOverflowPx: number;
  readonly from: FieldMetrics;
  readonly until: FieldMetrics;
};

type PairMetrics = { readonly error: string } | PairLayoutMetrics;

const topTolerancePx = 2;
const widthTolerancePx = 2;

const checkPair = (pair: PairMetrics): readonly string[] => {
  const failures: string[] = [];
  if ("error" in pair) return [`metrics error: ${pair.error}`];
  if (Math.abs(pair.from.top - pair.until.top) > topTolerancePx) {
    failures.push(
      `not one row: tops differ by ${Math.abs(pair.from.top - pair.until.top).toFixed(1)}px`
    );
  }
  if (Math.abs(pair.from.width - pair.until.width) > widthTolerancePx) {
    failures.push(
      `unequal widths: ${pair.from.width.toFixed(1)}px vs ${pair.until.width.toFixed(1)}px`
    );
  }
  for (const field of [pair.from, pair.until]) {
    if (Math.abs(field.width - pair.halfWidthExpected) > widthTolerancePx) {
      failures.push(
        `${field.name}: width ${field.width.toFixed(1)}px != half of wrapper minus gap ${pair.halfWidthExpected.toFixed(1)}px`
      );
    }
    if (field.right > pair.wrapperRight + 0.5) {
      failures.push(
        `${field.name}: right edge ${field.right.toFixed(1)}px exceeds wrapper right ${pair.wrapperRight.toFixed(1)}px`
      );
    }
    if (field.triggerTextOverflow !== null && field.triggerTextOverflow > 1) {
      failures.push(
        `${field.name}: trigger text overflows by ${field.triggerTextOverflow}px`
      );
    }
    if (field.triggerWithinBounds === false) {
      failures.push(`${field.name}: trigger extends past its field container`);
    }
  }
  if (pair.documentOverflowPx > 1) {
    failures.push(
      `document scrolls horizontally by ${pair.documentOverflowPx}px`
    );
  }
  return failures;
};

const openDialog = async (page: Page, dialog: "code" | "voucher") => {
  const triggerName =
    dialog === "code" ? "Create a discount code" : "Create a voucher";
  await page.getByRole("button", { name: triggerName }).click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
};

const pickStartDate = async (page: Page) => {
  await page.getByRole("button", { name: "Valid from", exact: true }).click();
  const grid = page.getByRole("grid");
  await grid.waitFor({ state: "visible" });
  const day = new Date().getDate().toString();
  await grid
    .locator("button:not([disabled])")
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first()
    .click();
  await grid.waitFor({ state: "hidden" });
};

const closeDialog = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page
    .locator('[role="dialog"][id^="radix-"]:not([aria-label])')
    .waitFor({ state: "hidden" });
};

const main = async () => {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(buildRoot, { recursive: true });
  await writeFile(
    actionsStubPath,
    `export const createDiscountAdminForm = () => { throw new Error("renderer stub"); };
export const createDiscountCodeAdminForm = () => { throw new Error("renderer stub"); };
export const deleteDiscountAdminForm = () => { throw new Error("renderer stub"); };
export const deleteDiscountCodeAdminForm = () => { throw new Error("renderer stub"); };
export const mutateDiscountAdmin = () => { throw new Error("renderer stub"); };
export const searchDiscountAdminCustomers = () => { throw new Error("renderer stub"); };
export const updateDiscountAdminForm = () => { throw new Error("renderer stub"); };
export const updateDiscountCodeAdminForm = () => { throw new Error("renderer stub"); };
`,
    "utf8"
  );
  await writeFile(
    envStubPath,
    `export const env = { NEXT_PUBLIC_POSTHOG_HOST: undefined, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined } as const;`,
    "utf8"
  );

  const build = await Bun.build({
    banner: "window.process ??= { env: {} };",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    entrypoints: [browserEntryPath],
    format: "esm",
    naming: { entry: "bundle.[ext]" },
    plugins: [createBuildPlugin()],
  });
  if (!build.success) {
    for (const log of build.logs) console.error(log);
    throw new Error("renderer bundle build failed");
  }
  for (const output of build.outputs) {
    if (output.kind === "entry-point" || output.kind === "chunk") {
      await Bun.write(join(buildRoot, "bundle.js"), output);
    }
  }
  const cssText = (
    await Promise.all(
      build.outputs
        .filter((output) => output.path.endsWith(".css"))
        .map((output) => output.text())
    )
  ).join("\n");
  if (cssText) {
    await writeFile(join(buildRoot, "bundle.css"), cssText, "utf8");
  }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      if (pathname === "/index.html") {
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${cssText ? '<link rel="stylesheet" href="/bundle.css">' : ""}</head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } }
        );
      }
      const file = Bun.file(join(buildRoot, pathname.slice(1)));
      if (!(await file.exists())) {
        return new Response("not found", { status: 404 });
      }
      return new Response(file);
    },
  });

  const browser: Browser = await chromium.launch({
    args: ["--disable-dev-shm-usage"],
  });
  const failures: string[] = [];
  const metricsByScenario: Record<string, PairMetrics> = {};

  try {
    for (const locale of locales) {
      const context: BrowserContext = await browser.newContext({
        locale,
        viewport: narrowViewport,
      });
      const page = await context.newPage();
      page.on("console", (message) => {
        if (message.type() === "error")
          console.error("[console]", message.text());
      });
      page.on("pageerror", (error) =>
        console.error("[pageerror]", error.message)
      );
      await page.goto(`http://localhost:${server.port}/`);
      await page
        .getByRole("button", { name: "Create a discount code" })
        .waitFor();

      for (const dialog of dialogs) {
        await openDialog(page, dialog);
        await pickStartDate(page);
        const screenshotDir = join(outputRoot, "screenshots");
        await mkdir(screenshotDir, { recursive: true });
        const suffix = `${dialog}-${locale}`;
        for (const width of captureWidths) {
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 1000,
          });
          await page.waitForTimeout(150);
          await page.screenshot({
            path: join(screenshotDir, `${suffix}-${width}.png`),
            fullPage: true,
          });
        }
        if (dialog === "code" || locale === "en-US") {
          // Metrics regressions run for both dialogs at the narrow width.
          await page.setViewportSize(narrowViewport);
          await page.waitForTimeout(150);
          const pairMetrics = (await page.evaluate(
            pairMetricsScript
          )) as PairMetrics;
          metricsByScenario[`${suffix}-390`] = pairMetrics;
          const scenarioFailures = checkPair(pairMetrics);
          if (scenarioFailures.length > 0) {
            failures.push(`${suffix}-390: ${scenarioFailures.join("; ")}`);
          }
        }
        await closeDialog(page);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.stop(true);
  }

  await writeFile(
    join(outputRoot, "narrow-pair-metrics.json"),
    JSON.stringify(metricsByScenario, null, 2),
    "utf8"
  );

  if (failures.length > 0) {
    // biome-ignore lint/suspicious/noConsole: CLI diagnostic output
    console.error("NARROW PAIR METRICS FAILED");
    // biome-ignore lint/suspicious/noConsole: CLI diagnostic output
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  // biome-ignore lint/suspicious/noConsole: CLI diagnostic output
  console.log("NARROW PAIR METRICS PASSED");
  for (const [scenario, pair] of Object.entries(metricsByScenario)) {
    if ("error" in pair) continue;
    // biome-ignore lint/suspicious/noConsole: CLI diagnostic output
    console.log(
      `${scenario}: viewport=${pair.viewportWidth} wrapper=${pair.wrapperWidth.toFixed(1)}px gap=${pair.gap}px halfExpected=${pair.halfWidthExpected.toFixed(1)}px | from w=${pair.from.width.toFixed(1)} top=${pair.from.top.toFixed(1)} right=${pair.from.right.toFixed(1)} triggerOverflow=${pair.from.triggerTextOverflow} | until w=${pair.until.width.toFixed(1)} top=${pair.until.top.toFixed(1)} right=${pair.until.right.toFixed(1)} triggerOverflow=${pair.until.triggerTextOverflow} | docOverflow=${pair.documentOverflowPx}`
    );
  }
};

await main();
