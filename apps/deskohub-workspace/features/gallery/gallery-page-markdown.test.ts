import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
  messagePlainText,
} from "@/shared/markdown/markdown.test-utils";
import { galleryPageMarkdown } from "./gallery-page-markdown";

// Left out on purpose: the metadata title and description, and the photos.
describe.each(locales)("galleryPageMarkdown in %s", (locale) => {
  test("shows the heading and the introduction with its links", async () => {
    const markdown = serializeMarkdown(
      await Effect.runPromise(galleryPageMarkdown(locale))
    );

    expect(markdownPlainText(markdown)).toBe(
      [
        m.galleryPageTitle({}, { locale }),
        messagePlainText(m.galleryPageIntro({}, { locale })),
      ].join("\n")
    );
    expect(markdown).toStartWith("# ");
    expect(markdownLinkUrls(markdown)).toEqual([
      "https://workspace.deskohub.cz/coworking",
      "https://workspace.deskohub.cz/reservation/cowork",
    ]);
  });
});
