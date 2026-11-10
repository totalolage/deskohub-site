import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { type Browser, chromium } from "@playwright/test";
import { nextFontLocal } from "@/shared/testing/next-font-local.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { languageNameFontProperty, languageNames } from "./language-labels";

mock.module("next/font/local", () => nextFontLocal);

const { languageNameFontStyle } = await import("./locale-fonts");

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const otherScriptLocales = supportedLocales.filter(
  (locale) => getLocaleDefinition(locale).script !== "latin"
);

// The name faces hold only the letters of the registry's native names, so a
// changed or added name must come with regenerated faces.
for (const locale of otherScriptLocales) {
  test.skipIf(!chromiumAvailable)(
    `draws every letter of ${locale}'s own name from its name face`,
    async () => {
      // Outside a Next.js build a face's family is its quoted source path,
      // relative to locale-fonts.ts.
      const [, face] =
        Object.entries(languageNameFontStyle).find(
          ([property]) => property === languageNameFontProperty(locale)
        ) ?? [];
      expect(face).toBeString();
      // The stand-in names a face of several weights by its first file, so
      // the face's other weight files are its siblings with the same stem.
      const firstFile = resolve(
        import.meta.dir,
        String(face).replaceAll("'", "")
      );
      const weightStem = /^(.*)-\d{3}\.woff2$/.exec(basename(firstFile))?.[1];
      const faceFiles = weightStem
        ? await Array.fromAsync(
            new Bun.Glob(`${weightStem}-[0-9][0-9][0-9].woff2`).scan({
              absolute: true,
              cwd: dirname(firstFile),
            })
          )
        : [firstFile];
      expect(faceFiles).toContain(firstFile);
      for (const file of faceFiles) {
        expect({
          file: basename(file),
          fallbacks: await fallbackFontsFor(
            languageNames[locale],
            await readFile(file)
          ),
        }).toEqual({ file: basename(file), fallbacks: [] });
      }
    }
  );
}

/** The system fonts a text takes letters from when set in the given face. */
async function fallbackFontsFor(text: string, fontFile: Buffer) {
  const page = await (browser as Browser).newPage();
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Language name"; src: url(data:font/woff2;base64,${fontFile.toString("base64")}) format("woff2"); }
</style></head><body><span id="name" style='font-family: "Language name", monospace'>${text}</span></body></html>`
    );
    await page.evaluate(() => document.fonts.ready);
    const session = await page.context().newCDPSession(page);
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#name",
    });
    const { fonts } = await session.send("CSS.getPlatformFontsForNode", {
      nodeId,
    });
    expect(fonts.length).toBeGreaterThan(0);
    return fonts.filter((font) => !font.isCustomFont).map((f) => f.familyName);
  } finally {
    await page.close();
  }
}
