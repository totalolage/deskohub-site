import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Locator } from "@playwright/test";
import { Effect } from "effect";
import { m } from "@/features/administration/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import type { CampaignBodyNode } from "../../body/campaign-body-document";
import { campaignBodyColumnWidth } from "../../body/campaign-image";
import {
  CampaignEmailFooter,
  renderCampaignEmail,
} from "../../body/render-campaign-email";

const chromiumAvailable = await playwrightChromiumAvailable();
const origin = "http://campaign-image.test";
const imageSource =
  "https://res.cloudinary.com/cloud/image/upload/v1/campaigns/synthetic.svg";
// A synthetic non-square image makes distorted height detectable.
const imageSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 600 300"><rect width="600" height="300" fill="#1c1f3b"/><rect x="20" y="20" width="260" height="260" fill="#f7941d"/><text x="320" y="160" fill="white" font-size="30">Deskohub</text></svg>';
let browser: Browser | undefined;
let directory = "";
let bundle = "";
let styles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  directory = await mkdtemp(join(tmpdir(), "campaign-image-browser-"));
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "campaign-body-editor.browser-harness.tsx"),
    ],
    format: "iife",
    // The standalone harness supplies the environment Next.js normally inlines.
    define: { "process.env": JSON.stringify({ NODE_ENV: "production" }) },
    minify: true,
    naming: "harness.js",
    outdir: directory,
    plugins: [
      browserModuleStubPlugin({
        "./actions":
          "export const authorizeCampaignImageUpload = async () => ({});",
      }),
    ],
    target: "browser",
  });
  if (!build.success)
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  bundle = join(directory, "harness.js");
  styles = await compileWorkspaceAppStyles();
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const dimensions = (image: Locator) =>
  image.evaluate(async (element: HTMLImageElement) => {
    // Editing attributes can replace the image with one still loading.
    await element.decode();
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });

for (const { locale, initialWidth } of [
  { locale: "en-US", initialWidth: 1068 },
  { locale: "cs-CZ", initialWidth: 1068 },
  { locale: "en-US", initialWidth: undefined },
] as const) {
  test.skipIf(!chromiumAvailable)(
    `resizes, saves and reopens a proportional image with width ${initialWidth} in the ${locale} editor and email HTML`,
    async () => {
      if (!browser) throw new Error("Chromium did not launch");
      const page = await browser.newPage({
        viewport: { width: 1200, height: 1100 },
      });
      page.setDefaultTimeout(5000);
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        const doc: CampaignBodyNode = {
          type: "doc",
          content: [
            {
              type: "image",
              attrs: {
                src: imageSource,
                alt: "Synthetic image",
                ...(initialWidth && { width: initialWidth, height: 534 }),
              },
            },
          ],
        };
        await page.route("**/*", (route) => {
          if (route.request().url() === imageSource)
            return route.fulfill({
              contentType: "image/svg+xml",
              body: imageSvg,
            });
          if (route.request().url().startsWith(origin))
            return route.fulfill({
              contentType: "text/html",
              body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="editor-root" data-locale="${locale}"></div></body></html>`,
            });
          return route.abort();
        });
        await page.goto(origin);
        await page.locator("#editor-root").evaluate((element, value) => {
          (element as HTMLElement).dataset.document = JSON.stringify(value);
        }, doc);
        await page.addStyleTag({ content: styles });
        await page.addScriptTag({ path: bundle });
        const editorImage = page.locator(".ProseMirror img");
        try {
          await editorImage.waitFor();
        } catch (cause) {
          throw new Error(`Editor failed to mount: ${pageErrors.join("; ")}`, {
            cause,
          });
        }
        expect(await dimensions(editorImage)).toEqual({
          width: 534,
          height: 267,
        });
        await editorImage.click();
        const input = page.getByRole("spinbutton", {
          name: m.emailCampaignsImageWidth({}, { locale }),
        });
        await input.fill("");
        await input.pressSequentially("180");
        expect(await input.inputValue()).toBe("180");
        expect(
          await input.evaluate((element) => document.activeElement === element)
        ).toBe(true);
        await input.press("ArrowUp");
        expect(await input.inputValue()).toBe("181");
        await input.press("ArrowDown");
        await input.press("Enter");
        expect(
          await page.evaluate(() => localStorage.getItem("campaign-body"))
        ).toBeNull();
        expect(await dimensions(editorImage)).toEqual({
          width: 180,
          height: 90,
        });
        await page
          .getByRole("button", { name: "Save fixture", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Reopen fixture", exact: true })
          .click();
        await editorImage.click();
        expect(await input.inputValue()).toBe("180");
        const saved: CampaignBodyNode = JSON.parse(
          (await page.getByTestId("document").textContent()) ?? "null"
        );
        expect(saved.content?.[0]?.attrs).toMatchObject({
          width: 180,
          height: null,
        });
        const render = (body: CampaignBodyNode) =>
          Effect.runPromise(
            renderCampaignEmail({
              templateKey: "workspace",
              locale,
              footer: CampaignEmailFooter.Operational(),
              content: {
                subject: "Synthetic image sizing",
                preheader: "Preview",
                body: { formatVersion: 1, doc: body },
              },
            })
          );
        const email = await render(saved);
        const htmlImage = email.html.match(
          /<img[^>]*alt="Synthetic image"[^>]*>/
        )?.[0];
        expect(htmlImage).toContain('width="180"');
        expect(htmlImage).toContain("height:auto");
        expect(htmlImage).toContain("max-width:100%");
        await page
          .getByTitle("Email preview", { exact: true })
          .evaluate((element, html) => {
            (element as HTMLIFrameElement).srcdoc = html;
          }, email.html);
        const previewImage = page
          .frameLocator('iframe[title="Email preview"]')
          .getByAltText("Synthetic image");
        await previewImage.waitFor();
        expect(await dimensions(previewImage)).toEqual({
          width: 180,
          height: 90,
        });
        // Maximum size must still fit the editor and rendered email on mobile.
        await input.fill(String(campaignBodyColumnWidth));
        const wide: CampaignBodyNode = JSON.parse(
          (await page.getByTestId("document").textContent()) ?? "null"
        );
        const wideEmail = await render(wide);
        await page
          .getByTitle("Email preview", { exact: true })
          .evaluate((element, html) => {
            (element as HTMLIFrameElement).srcdoc = html;
          }, wideEmail.html);
        await page.setViewportSize({ width: 390, height: 844 });
        await previewImage.waitFor();
        for (const image of [editorImage, previewImage]) {
          const size = await dimensions(image);
          expect(size.width).toBeLessThan(390);
          expect(size.width).toBeGreaterThan(200);
          expect(size.height).toBeCloseTo(size.width / 2, 1);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBe(390);
      } finally {
        await page.close();
      }
    }
  );
}
