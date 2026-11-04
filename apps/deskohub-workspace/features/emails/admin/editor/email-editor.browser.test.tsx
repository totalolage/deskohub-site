import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import type { EmailDraftFormValues } from "./email-draft-form";
import { fixtureDraft } from "./email-editor.fixtures.test-utils";
import { emailEditorFieldIds } from "./email-editor-field-ids";

const chromiumAvailable = await playwrightChromiumAvailable();
const origin = "http://email-editor.test";
/** Screenshots for review evidence land here when the variable is set. */
const screenshotDirectory = process.env.EMAIL_EDITOR_SCREENSHOTS;
const authorization = {
  url: "https://api.cloudinary.test/v1_1/cloud/image/upload",
  fields: { public_id: "4f1c0b9e", signature: "fake-upload-signature" },
  publicId: "email-campaigns/preview/4f1c0b9e",
};
let browser: Browser | undefined;
let directory = "";
let bundle = "";
let styles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  directory = await mkdtemp(join(tmpdir(), "email-editor-browser-"));
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "email-editor.browser-harness.tsx")],
    // The contract package reaches Effect's environment config, which reads
    // `import.meta`, so the harness loads as a module.
    format: "esm",
    // The standalone harness supplies the environment Next.js normally inlines.
    define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
    minify: true,
    naming: "harness.js",
    outdir: directory,
    plugins: [
      browserModuleStubPlugin({
        // The authorization is stubbed at the action module; the upload
        // itself goes through the real browser code to a routed Cloudinary.
        "./image-upload-actions": `export const authorizeEmailImageUpload = async () => ({ data: ${JSON.stringify(authorization)} });`,
      }),
    ],
    target: "browser",
  });
  if (!build.success)
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  bundle = join(directory, "harness.js");
  styles = await compileWorkspaceAppStyles();
  browser = await chromium.launch({ headless: true });
  if (screenshotDirectory)
    await mkdir(screenshotDirectory, { recursive: true });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

/** Opens the harness in `locale` with `draft` and waits for the editor. */
const openEditor = async (
  locale: Locale,
  draft: EmailDraftFormValues = fixtureDraft
): Promise<Page> => {
  if (!browser) throw new Error("Chromium did not launch");
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1200 },
  });
  page.setDefaultTimeout(5000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin))
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="editor-root" data-locale="${locale}"></div></body></html>`,
      });
    return route.abort();
  });
  await page.goto(origin);
  await page.locator("#editor-root").evaluate((element, value) => {
    (element as HTMLElement).dataset.draft = JSON.stringify(value);
  }, draft);
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ path: bundle, type: "module" });
  try {
    await page
      .getByRole("heading", {
        name: m.emailsEditorProblemsHeading({}, { locale }),
      })
      .waitFor();
  } catch (cause) {
    throw new Error(`Editor failed to mount: ${pageErrors.join("; ")}`, {
      cause,
    });
  }
  return page;
};

const screenshot = async (page: Page, name: string) => {
  if (!screenshotDirectory) return;
  await page.screenshot({
    path: join(screenshotDirectory, `${name}.png`),
    fullPage: true,
  });
};

const summaryItem = (
  page: Page,
  locale: Locale,
  place: string,
  message: string
) =>
  page
    .getByRole("region", {
      name: m.emailsEditorProblemsHeading({}, { locale }),
    })
    .getByRole("button", {
      name: m.emailsEditorProblemSummaryItem({ place, message }, { locale }),
      exact: true,
    });

for (const locale of ["en-US", "cs-CZ"] as const) {
  test.skipIf(!chromiumAvailable)(
    `lists the problems of a broken draft in the ${locale} editor, focuses their fields and still saves the draft`,
    async () => {
      const page = await openEditor(locale);
      try {
        const czech = m.emailsEditorLanguageCzech({}, { locale });
        // The incomplete Czech translation and the reference to a value
        // that no longer exists are both listed.
        const missingIntro = summaryItem(
          page,
          locale,
          m.emailsEditorPlaceBlockText(
            { number: 2, language: czech },
            { locale }
          ),
          m.emailsEditorProblemTextMissing({}, { locale })
        );
        await missingIntro.waitFor();
        await summaryItem(
          page,
          locale,
          m.emailsEditorPlaceBlockText(
            {
              number: 4,
              language: m.emailsEditorLanguageEnglish({}, { locale }),
            },
            { locale }
          ),
          m.emailsEditorProblemValueUnknown({ name: "last_visit" }, { locale })
        ).waitFor();
        const czechTab = page.getByRole("tab", { name: new RegExp(czech) });
        // Czech, the first Workspace language, opens first; show English.
        await page
          .getByRole("tab", {
            name: new RegExp(m.emailsEditorLanguageEnglish({}, { locale })),
          })
          .click();
        expect(await czechTab.getAttribute("aria-selected")).toBe("false");
        expect(await czechTab.textContent()).toContain(
          m.emailsEditorLanguageProblemCount({ count: 3 }, { locale })
        );
        await screenshot(page, `editor-problems-${locale}`);

        await missingIntro.click();
        expect(await czechTab.getAttribute("aria-selected")).toBe("true");
        const introId = emailEditorFieldIds.text("cs-CZ", "paragraph-1-text");
        await page.waitForFunction(
          (id) => document.activeElement?.id === id,
          introId
        );
        const intro = page.locator(`[id="${introId}"]`);
        expect(await intro.getAttribute("aria-invalid")).toBe("true");
        const describedBy = await intro.getAttribute("aria-describedby");
        expect(
          await page.locator(`[id="${describedBy}"]`).textContent()
        ).toContain(m.emailsEditorProblemTextMissing({}, { locale }));

        // Saving validates only the draft shape: the problems don't block it.
        await page
          .getByRole("button", { name: "Save draft", exact: true })
          .click();
        const saved = JSON.parse(
          (await page.getByTestId("saved").textContent()) ?? "{}"
        );
        expect(saved.invalid).toBeUndefined();
        expect(saved.saved.translations["cs-CZ"].texts).toEqual(
          fixtureDraft.translations?.["cs-CZ"]?.texts
        );
      } finally {
        await page.close();
      }
    },
    30_000
  );
}

// Keeps the authorization fixture referenced until the upload scenario lands.
void authorization;
