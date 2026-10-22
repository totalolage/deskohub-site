import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { ttrpgRoomPageMarkdown } from "./ttrpg-room-page-markdown";

// Left out on purpose: the metadata title and description, which the page
// sends as metadata, and the photo carousels (ttrpgRoomCarouselOpen,
// ttrpgRoomPhotosComingSoon). The Bar's prefilled contact message
// (ttrpgRoomBarPrefillMessage) only appears in its link.
describe.each(locales)("ttrpgRoomPageMarkdown in %s", (locale) => {
  test("shows each room with its venue, capacity and call to action", async () => {
    const markdown = serializeMarkdown(
      await Effect.runPromise(ttrpgRoomPageMarkdown(locale))
    );

    expect(markdownPlainText(markdown)).toBe(
      [
        m.ttrpgRoomHeroTitle({}, { locale }),
        m.ttrpgRoomBarChoiceTitle({}, { locale }),
        m.ttrpgRoomBarRoomLabel({}, { locale }),
        m.ttrpgRoomBarCapacity({}, { locale }),
        m.ttrpgRoomBarCta({}, { locale }),
        m.ttrpgRoomWorkspaceChoiceTitle({}, { locale }),
        m.ttrpgRoomWorkspaceRoomLabel({}, { locale }),
        m.ttrpgRoomWorkspaceCapacity({}, { locale }),
        m.ttrpgRoomWorkspaceCta({}, { locale }),
      ].join("\n")
    );
    expect(markdown).toStartWith(`# ${m.ttrpgRoomHeroTitle({}, { locale })}`);
  });

  test("links the Bar room to its prefilled contact form and the Workspace room to booking", async () => {
    const [barUrl, workspaceUrl, ...rest] = markdownLinkUrls(
      serializeMarkdown(await Effect.runPromise(ttrpgRoomPageMarkdown(locale)))
    );
    const barContact = new URL(barUrl ?? "");

    expect(rest).toEqual([]);
    expect(`${barContact.origin}${barContact.pathname}`).toBe(
      `https://bar.deskohub.cz/${locale}/contact`
    );
    expect(barContact.searchParams.get("message")).toBe(
      m.ttrpgRoomBarPrefillMessage({}, { locale })
    );
    expect(barContact.hash).toBe("#contact-form");
    expect(workspaceUrl).toBe(
      "https://workspace.deskohub.cz/reservation/meeting-room"
    );
  });
});
