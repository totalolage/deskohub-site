import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { locales } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { getAiAssistantsGuide } from "./ai-assistants-guide";
import { aiAssistantsPageMarkdown } from "./ai-assistants-page-markdown";

describe.each(locales)("aiAssistantsPageMarkdown in %s", (locale) => {
  const guide = getAiAssistantsGuide(locale);
  const markdown = async () =>
    serializeMarkdown(
      await Effect.runPromise(aiAssistantsPageMarkdown(locale))
    );

  test("opens with the title and keeps every section heading in order", async () => {
    const body = await markdown();

    expect(body).toStartWith(`# ${guide.title}`);
    const headings = body
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3));
    expect(headings).toEqual(guide.sections.map((section) => section.heading));
  });

  test("links absolutely and locale-agnostically and leaves no template syntax", async () => {
    const body = await markdown();

    expect(markdownPlainText(body)).not.toMatch(/<\/?\w+>|\{\w+\}/);
    const urls = markdownLinkUrls(body);
    expect(urls.length).toBeGreaterThan(Object.keys(guide.links).length);
    expect(urls).toContain("https://workspace.deskohub.cz/privacy-policy");
    for (const url of urls) {
      expect(url).toMatch(/^(https:\/\/|mailto:)/);
      if (!url.startsWith("https://workspace.deskohub.cz/")) continue;
      for (const pageLocale of locales) {
        expect(new URL(url).pathname.split("/")).not.toContain(pageLocale);
      }
    }
  });

  test("numbers every step of each set of steps from one", async () => {
    const body = await markdown();
    const expected = guide.sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        block.kind === "steps" ? block.items.map((_, index) => index + 1) : []
      )
    );

    expect(expected.length).toBeGreaterThan(0);
    expect(
      [...body.matchAll(/^(\d+)\. /gm)].map(([, number]) => Number(number))
    ).toEqual(expected);
  });
});
