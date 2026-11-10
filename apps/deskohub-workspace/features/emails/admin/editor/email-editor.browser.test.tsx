import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import {
  type Browser,
  chromium,
  type Locator,
  type Page,
} from "@playwright/test";
import { m } from "@/features/administration/i18n";
import { locales as administrationLocales } from "@/features/administration/i18n/paraglide/runtime.js";
import type { Locale } from "@/features/i18n";
import { languageNames } from "@/features/i18n/language-labels";
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

const uploadedImageUrl = `https://res.cloudinary.com/cloud/image/upload/v1/${authorization.publicId}.png`;
// A synthetic 1×1 picture.
const picture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const pageErrorsOf = new WeakMap<Page, readonly string[]>();

/** Fails the scenario if the page threw, even where the UI recovered. */
const expectNoPageErrors = (page: Page) =>
  expect(pageErrorsOf.get(page) ?? []).toEqual([]);

/**
 * Opens the harness in `locale` with `draft` and waits for the editor. The
 * routed Cloudinary answers an upload with `storedPublicId`.
 */
const openEditor = async (
  locale: Locale,
  {
    draft = fixtureDraft,
    storedPublicId = authorization.publicId,
  }: {
    readonly draft?: EmailDraftFormValues;
    readonly storedPublicId?: string;
  } = {}
): Promise<Page> => {
  if (!browser) throw new Error("Chromium did not launch");
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1200 },
  });
  page.setDefaultTimeout(5000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  pageErrorsOf.set(page, pageErrors);
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url === authorization.url)
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          public_id: storedPublicId,
          secure_url: uploadedImageUrl,
          width: 1068,
        }),
      });
    if (url === uploadedImageUrl)
      return route.fulfill({ contentType: "image/png", body: picture });
    if (url.startsWith(origin))
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

/** Waits until no enter or exit animation is still running. */
const settleAnimations = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running")
  );

const screenshot = async (page: Page, name: string, part?: Locator) => {
  if (!screenshotDirectory) return;
  await settleAnimations(page);
  const path = join(screenshotDirectory, `${name}.png`);
  await (part
    ? part.screenshot({ path })
    : page.screenshot({ path, fullPage: true }));
};

const showLanguage = (page: Page, language: Locale) =>
  page.getByRole("tab", { name: new RegExp(languageNames[language]) }).click();

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

for (const locale of administrationLocales) {
  test.skipIf(!chromiumAvailable)(
    `lists the problems of a broken draft in the ${locale} editor, focuses their fields and still saves the draft`,
    async () => {
      const page = await openEditor(locale);
      try {
        const czech = languageNames["cs-CZ"];
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
            { number: 4, language: languageNames["en-US"] },
            { locale }
          ),
          m.emailsEditorProblemValueUnknown({ name: "last_visit" }, { locale })
        ).waitFor();
        // Every Workspace language has a tab, and the first one opens.
        const tabs = page.getByRole("tablist").getByRole("tab");
        expect(await tabs.count()).toBe(supportedLocales.length);
        for (const [index, language] of supportedLocales.entries())
          expect(await tabs.nth(index).textContent()).toContain(
            languageNames[language]
          );
        expect(await tabs.first().getAttribute("aria-selected")).toBe("true");
        // Each tab shows its language's texts.
        for (const language of supportedLocales) {
          await showLanguage(page, language);
          await page
            .locator(
              `[id="${emailEditorFieldIds.translation(language, "subject")}"]`
            )
            .waitFor();
        }
        await showLanguage(page, "en-US");
        const czechTab = page.getByRole("tab", { name: new RegExp(czech) });
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
        expectNoPageErrors(page);
      } finally {
        await page.close();
      }
    },
    30_000
  );
}

/** The fixture's heading text in `language`. */
const headingOf = (language: Locale) => {
  const heading = (
    fixtureDraft.translations?.[language]?.texts?.["heading-1-text"] ?? []
  )
    .map((part) => (part._tag === "Text" ? part.text : ""))
    .join("");
  if (!heading) throw new Error(`The fixture has no ${language} heading.`);
  return heading;
};

/** The saved draft after pressing the harness's save button. */
const saveDraft = async (page: Page): Promise<EmailDraftFormValues> => {
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const result = JSON.parse(
    (await page.getByTestId("saved").textContent()) ?? "{}"
  );
  expect(result.invalid).toBeUndefined();
  return result.saved;
};

for (const locale of administrationLocales) {
  test.skipIf(!chromiumAvailable)(
    `marks the unused value, searches customer fields and turns a deleted used value's references red in the ${locale} editor`,
    async () => {
      const page = await openEditor(locale);
      try {
        const values = page.getByRole("region", {
          name: m.emailsEditorValuesHeading({}, { locale }),
        });
        const unused = m.emailsEditorValuesUnused({}, { locale });
        expect(
          await page
            .locator(`[id="${emailEditorFieldIds.value(2)}"]`)
            .textContent()
        ).toContain(unused);
        expect(
          await page
            .locator(`[id="${emailEditorFieldIds.value(0)}"]`)
            .textContent()
        ).not.toContain(unused);

        await values
          .getByRole("button", {
            name: m.emailsEditorValuesAddCustomer({}, { locale }),
          })
          .click();
        const search = page.getByPlaceholder(
          m.emailsEditorValuesPickerSearch({}, { locale })
        );
        await search.fill("displayName");
        await page
          .getByRole("option", { name: /profile\.customer\.displayName/ })
          .waitFor();
        expect(
          await page.getByRole("option", { name: /activity\./ }).count()
        ).toBe(0);
        // The picker is portaled; capture the viewport around it.
        await search.evaluate((element) =>
          element.scrollIntoView({ block: "center" })
        );
        await settleAnimations(page);
        if (screenshotDirectory)
          await page.screenshot({
            path: join(screenshotDirectory, `values-picker-${locale}.png`),
          });
        await search.press("Escape");

        // The tab that opens shows its subject's value chip.
        const [opening] = supportedLocales;
        const subjectChip = (language: string) =>
          page.locator(
            `[id="${emailEditorFieldIds.translation(language, "subject")}"] [data-name="customer_name"]`
          );
        expect(
          await subjectChip(opening).getAttribute("data-missing")
        ).toBeNull();
        await values
          .getByRole("button", {
            name: m.emailsEditorValuesDelete(
              { name: "customer_name" },
              { locale }
            ),
          })
          .click();
        // Every use is now an unknown value, in every language.
        const unknown = m.emailsEditorProblemValueUnknown(
          { name: "customer_name" },
          { locale }
        );
        for (const language of supportedLocales)
          await summaryItem(
            page,
            locale,
            m.emailsEditorPlaceSubject(
              { language: languageNames[language] },
              { locale }
            ),
            unknown
          ).waitFor();
        await subjectChip(opening)
          .and(page.locator("[data-missing]"))
          .waitFor();
        expect(
          await page
            .locator(
              `[id="${emailEditorFieldIds.translation(opening, "subject")}"]`
            )
            .getAttribute("aria-invalid")
        ).toBe("true");
        // The draft still saves without the definition.
        const saved = await saveDraft(page);
        expect(saved.values?.map((definition) => definition.name)).toEqual([
          "welcome_offer",
          "unused_count",
        ]);
        expectNoPageErrors(page);
      } finally {
        await page.close();
      }
    },
    30_000
  );
}

test.skipIf(!chromiumAvailable)(
  "keeps translated texts lossless through the inline editors and follows host resets",
  async () => {
    const locale = "en-US";
    const page = await openEditor(locale);
    try {
      await showLanguage(page, "en-US");
      const intro = page.locator(
        `[id="${emailEditorFieldIds.text("en-US", "paragraph-1-text")}"]`
      );
      await intro.locator('[data-name="customer_name"]').waitFor();
      expect(await intro.locator("strong").textContent()).toBe("our spaces");

      const subject = page.locator(
        `[id="${emailEditorFieldIds.translation("en-US", "subject")}"]`
      );
      await subject.click();
      await page.keyboard.press("End");
      await page.keyboard.type("!");

      const preheaderId = emailEditorFieldIds.translation("en-US", "preheader");
      const preheader = page.locator(`[id="${preheaderId}"]`);
      await preheader.click();
      await page.keyboard.press("End");
      await page.keyboard.type(", code ");
      await preheader
        .locator("xpath=ancestor::*[.//*[@role='toolbar']][1]")
        .getByRole("button", {
          name: m.emailsEditorInlineValueInsert({}, { locale }),
        })
        .click();
      await page
        .getByPlaceholder(m.emailsEditorInlineValueSearch({}, { locale }))
        .fill("welcome_offer.code");
      await page.keyboard.press("Enter");
      await preheader.locator('[data-name="welcome_offer"]').waitFor();

      const saved = await saveDraft(page);
      const english = saved.translations?.["en-US"];
      expect(english?.subject).toEqual([
        { _tag: "Text", text: "Hello " },
        { _tag: "Value", name: "customer_name" },
        { _tag: "Text", text: "!" },
      ]);
      expect(english?.preheader).toEqual([
        { _tag: "Text", text: "A synthetic update, code " },
        { _tag: "Value", name: "welcome_offer", field: ["code"] },
      ]);
      // Texts the author didn't touch keep every part and mark.
      expect(english?.texts).toEqual({
        ...fixtureDraft.translations?.["en-US"]?.texts,
      });

      await page
        .getByRole("button", { name: "Reset draft", exact: true })
        .click();
      await preheader.locator('[data-name="welcome_offer"]').waitFor({
        state: "detached",
      });
      expect(await subject.textContent()).not.toContain("!");
      expect((await saveDraft(page)).translations?.["en-US"]).toEqual(
        fixtureDraft.translations?.["en-US"]
      );
      expectNoPageErrors(page);
    } finally {
      await page.close();
    }
  },
  30_000
);

for (const { name, storedPublicId, accepted } of [
  {
    name: "accepts an upload stored under the authorized public ID",
    storedPublicId: authorization.publicId,
    accepted: true,
  },
  {
    name: "refuses an upload Cloudinary stored under another public ID",
    storedPublicId: "email-campaigns/preview/someone-else",
    accepted: false,
  },
]) {
  test.skipIf(!chromiumAvailable)(
    `${name} through the image block`,
    async () => {
      const locale = "en-US";
      const page = await openEditor(locale, { storedPublicId });
      try {
        await page
          .getByRole("button", {
            name: m.emailsEditorStructureAddBlock({}, { locale }),
          })
          .click();
        const imageItem = page.getByRole("menuitem", {
          name: m.emailsEditorBlockImage({}, { locale }),
          exact: true,
        });
        await imageItem.waitFor();
        await imageItem.click();
        const chooser = page.waitForEvent("filechooser");
        await page
          .getByRole("button", {
            name: m.emailsEditorBlockImageUpload({}, { locale }),
          })
          .click();
        await (await chooser).setFiles({
          name: "synthetic.png",
          mimeType: "image/png",
          buffer: picture,
        });
        const images = () =>
          saveDraft(page).then((saved) =>
            (saved.structure ?? []).filter(
              (component) => component._tag === "Image"
            )
          );
        if (accepted) {
          await page
            .getByRole("button", {
              name: m.emailsEditorBlockImageReplace({}, { locale }),
            })
            .waitFor();
          expect((await images())[0]?.src).toBe(uploadedImageUrl);
          // An editor upload from the account is allowed to publish.
          expect(
            await page
              .getByText(m.emailsEditorProblemImageNotAllowed({}, { locale }))
              .count()
          ).toBe(0);
        } else {
          await page
            .getByRole("alert")
            .filter({
              hasText: m.emailsEditorImageUploadFailed({}, { locale }),
            })
            .waitFor();
          expect((await images())[0]?.src).toBeUndefined();
        }
        expectNoPageErrors(page);
      } finally {
        await page.close();
      }
    },
    30_000
  );
}

for (const locale of administrationLocales) {
  test.skipIf(!chromiumAvailable)(
    `previews the active language with sample values in the ${locale} editor`,
    async () => {
      const page = await openEditor(locale);
      try {
        await showLanguage(page, "en-US");
        const preview = page.getByRole("region", {
          name: new RegExp(m.emailsEditorPreviewHeading({}, { locale })),
        });
        const frame = page.frameLocator(
          `iframe[title="${m.emailsEditorPreviewFrameTitle(
            { language: languageNames["en-US"] },
            { locale }
          )}"]`
        );
        await frame.getByText(headingOf("en-US")).waitFor();
        // The host's sample value reaches the renderer.
        await frame.getByText("Hi Jana Nováková, see our spaces").waitFor();
        expect(await preview.textContent()).toContain(
          m.emailsEditorPreviewSampleNote({}, { locale })
        );
        await screenshot(page, `preview-${locale}`, preview);
        // Every other language previews its own texts.
        for (const language of supportedLocales.filter(
          (language) => language !== "en-US"
        )) {
          await showLanguage(page, language);
          await page
            .frameLocator(
              `iframe[title="${m.emailsEditorPreviewFrameTitle(
                { language: languageNames[language] },
                { locale }
              )}"]`
            )
            .getByText(headingOf(language))
            .waitFor();
        }
        expectNoPageErrors(page);
      } finally {
        await page.close();
      }
    },
    30_000
  );
}

test.skipIf(!chromiumAvailable)(
  "lets the author repair a retired language's translation and a reason kept on a marketing email",
  async () => {
    const locale = "en-US";
    const page = await openEditor(locale, {
      draft: {
        ...fixtureDraft,
        translations: {
          ...fixtureDraft.translations,
          "en-US": {
            ...fixtureDraft.translations?.["en-US"],
            operationalReason: [{ _tag: "Value", name: "gone_value" }],
          },
          "fr-FR": { subject: [{ _tag: "Text", text: "Bonjour" }] },
        },
      },
    });
    try {
      // The retired language has no tab; its problems point at its removal.
      const removeId = emailEditorFieldIds.retiredTranslation("fr-FR");
      const retiredProblem = page
        .getByRole("region", {
          name: m.emailsEditorProblemsHeading({}, { locale }),
        })
        .getByRole("button", {
          name: new RegExp(
            m
              .emailsEditorPlaceBlockText(
                { number: 2, language: "fr-FR" },
                { locale }
              )
              .replace(/[()]/g, "\\$&")
          ),
        })
        .first();
      await retiredProblem.click();
      await page.waitForFunction(
        (id) => document.activeElement?.id === id,
        removeId
      );
      await page.locator(`[id="${removeId}"]`).click();
      await page.locator(`[id="${removeId}"]`).waitFor({ state: "detached" });
      expect((await saveDraft(page)).translations?.["fr-FR"]).toBeUndefined();

      // A reason stored on a marketing email stays visible and repairable.
      await showLanguage(page, "en-US");
      const reasonId = emailEditorFieldIds.translation(
        "en-US",
        "operationalReason"
      );
      await summaryItem(
        page,
        locale,
        m.emailsEditorPlaceOperationalReason(
          { language: languageNames["en-US"] },
          { locale }
        ),
        m.emailsEditorProblemValueUnknown({ name: "gone_value" }, { locale })
      ).click();
      await page.waitForFunction(
        (id) => document.activeElement?.id === id,
        reasonId
      );
      await page
        .getByText(m.emailsEditorOperationalReasonUnusedHint({}, { locale }))
        .waitFor();
      expectNoPageErrors(page);
    } finally {
      await page.close();
    }
  },
  30_000
);
