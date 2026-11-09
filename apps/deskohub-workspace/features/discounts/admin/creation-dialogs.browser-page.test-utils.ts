import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";

const appDirectory = resolve(import.meta.dir, "../../..");

// The dialogs only reach the router and the Server Actions after a valid
// save, which the browser checks never make.
const moduleStubs: Readonly<Record<string, string>> = {
  "next/navigation": `
    const router = { back() {}, forward() {}, prefetch() {}, push() {}, refresh() {}, replace() {} };
    export const useRouter = () => router;
  `,
};

/** Replaces the discount administration's Server Actions module only. */
const discountActionsStubPlugin: Bun.BunPlugin = {
  name: "discount-admin-actions-stub",
  setup(build) {
    const namespace = "discount-admin-actions-stub";
    build.onResolve({ filter: /^\.\/actions$/ }, (args) =>
      dirname(args.importer) === import.meta.dir
        ? { namespace, path: args.path }
        : undefined
    );
    build.onLoad({ filter: /.*/, namespace }, () => ({
      contents: `
        export const mutateDiscountAdmin = async () => ({});
        export const searchDiscountAdminCustomers = async () => ({});
      `,
      loader: "js",
    }));
  },
};

export type DiscountDialogsBrowserPage = {
  readonly bundlePath: string;
  readonly dispose: () => Promise<void>;
  /** The app stylesheet with the brand font production text widths use. */
  readonly styles: string;
};

/**
 * Bundles the discount creation dialogs harness for a real browser, with the
 * app's styles and brand font.
 */
export const buildDiscountDialogsBrowserPage =
  async (): Promise<DiscountDialogsBrowserPage> => {
    const directory = await mkdtemp(join(tmpdir(), "discount-dialogs-"));
    const build = await Bun.build({
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      entrypoints: [
        join(import.meta.dir, "creation-dialogs.browser-harness.tsx"),
      ],
      format: "iife",
      minify: true,
      naming: "[name]-[hash].[ext]",
      outdir: directory,
      plugins: [
        discountActionsStubPlugin,
        browserModuleStubPlugin(moduleStubs),
      ],
      target: "browser",
    });
    if (!build.success) {
      await rm(directory, { force: true, recursive: true });
      throw new Error(
        `The discount dialogs harness failed to build:\n${build.logs
          .map((log) => log.message)
          .join("\n")}`
      );
    }
    const entry = build.outputs.find((output) => output.kind === "entry-point");
    if (!entry) throw new Error("The discount dialogs harness has no entry.");
    // Stylesheets the bundle imports itself, such as the calendar's.
    const bundledStyles = await Promise.all(
      build.outputs
        .filter((output) => output.path.endsWith(".css"))
        .map((output) => output.text())
    );
    const brandFont = await readFile(
      join(appDirectory, "assets/fonts/Sculpin/regular.woff2")
    );
    return {
      bundlePath: entry.path,
      dispose: () => rm(directory, { force: true, recursive: true }),
      styles: `@font-face { font-family: "Sculpin"; font-weight: 400; src: url(data:font/woff2;base64,${brandFont.toString("base64")}) format("woff2"); }
:root { --font-sculpin: "Sculpin"; }
${await compileWorkspaceAppStyles()}
${bundledStyles.join("\n")}
*, *::before, *::after { transition: none !important; animation: none !important; }`,
    };
  };

export type DiscountDialog = "code" | "voucher";

const harnessOrigin = "http://discount-dialogs.test";

/** Opens one creation dialog in `locale` and waits for its fonts. */
export const openDiscountDialog = async (
  page: Page,
  harness: DiscountDialogsBrowserPage,
  {
    dialog,
    locale,
  }: { readonly dialog: DiscountDialog; readonly locale: Locale }
) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // A real origin, so client code can read cookies.
  await page.route(`${harnessOrigin}/**`, (route) =>
    route.fulfill({
      body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="discount-dialogs-root"></div></body></html>`,
      contentType: "text/html; charset=utf-8",
    })
  );
  await page.goto(`${harnessOrigin}/`);
  // Client modules read unset public environment variables as undefined, as
  // they do in a Next build.
  await page.addScriptTag({
    content: "globalThis.process = { env: { NODE_ENV: 'production' } };",
  });
  await page.addStyleTag({ content: harness.styles });
  await page.addScriptTag({ path: harness.bundlePath });
  const trigger = page.getByRole("button", {
    name:
      dialog === "code"
        ? m.discountsCodeCreateButton({}, { locale })
        : m.discountsVoucherCreateButton({}, { locale }),
  });
  try {
    await trigger.waitFor({ timeout: 10_000 });
  } catch (error) {
    throw new Error(
      `The discount dialogs harness did not render: ${pageErrors.join("; ") || String(error)}`
    );
  }
  await trigger.click();
  const dialogElement = discountDialog(page);
  await dialogElement.waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return dialogElement;
};

/**
 * The open creation dialog. A calendar the date fields open is a dialog too,
 * portalled after it.
 */
export const discountDialog = (page: Page) => page.getByRole("dialog").first();

/** The redemption window and reservation date fields, by their names. */
export const discountDateFields = (page: Page, locale: Locale) => {
  const dialog = discountDialog(page);
  return {
    serviceDateFrom: dialog.getByRole("combobox", {
      exact: true,
      name: m.discountsServiceDateFromLabel({}, { locale }),
    }),
    serviceDateUntil: dialog.getByRole("combobox", {
      exact: true,
      name: m.discountsServiceDateUntilLabel({}, { locale }),
    }),
    validFrom: dialog.getByRole("combobox", {
      exact: true,
      name: m.discountsValidFromLabel({}, { locale }),
    }),
    validFromTime: dialog.getByLabel(
      m.discountsValidFromTimeLabel({}, { locale }),
      { exact: true }
    ),
    validUntil: dialog.getByRole("combobox", {
      exact: true,
      name: m.discountsValidUntilLabel({}, { locale }),
    }),
    validUntilTime: dialog.getByLabel(
      m.discountsValidUntilTimeLabel({}, { locale }),
      { exact: true }
    ),
  };
};

/**
 * Types a date and leaves the field, which is when typed text becomes the
 * date. A time field's `fill` sets its value without moving focus, so a date
 * left unfinished before it would never be committed.
 */
export const enterDate = async (field: Locator, text: string) => {
  await field.fill(text);
  await field.press("Tab");
};
