import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
  messagePlainText,
} from "@/shared/markdown/markdown.test-utils";
import { teamPageMarkdown } from "./team-page-markdown";

// Left out on purpose: the metadata title and description, which the page
// sends as metadata. Profile photos and the censored third name are
// decoration.
describe.each(locales)("teamPageMarkdown in %s", (locale) => {
  test("shows the story, then each founder's name, role and description in page order", async () => {
    const markdown = serializeMarkdown(
      await Effect.runPromise(teamPageMarkdown(locale))
    );

    expect(markdownPlainText(markdown)).toBe(
      [
        m.landingFoundersTitle({}, { locale }),
        m.teamAboutLead({}, { locale }),
        messagePlainText(m.teamAboutBody({}, { locale })),
        m.landingFounderDanicaRole({}, { locale }),
        "Danica",
        m.landingFounderDanicaDescription({}, { locale }),
        m.landingFounderFilipRole({}, { locale }),
        "Filip",
        m.landingFounderFilipDescription({}, { locale }),
        m.landingFounderHardwareRole({}, { locale }),
        m.landingFounderHardwareDescription({}, { locale }),
      ].join("\n")
    );
    expect(markdown).toStartWith(`# ${m.landingFoundersTitle({}, { locale })}`);
    expect(markdown).toContain(
      `\n## ${m.landingFounderHardwareRole({}, { locale })}\n`
    );
    expect(markdownLinkUrls(markdown)).toEqual([
      "https://workspace.deskohub.cz/contact",
    ]);
  });
});
