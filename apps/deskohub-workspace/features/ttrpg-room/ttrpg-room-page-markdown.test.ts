import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
  messagePlainText,
} from "@/shared/markdown/markdown.test-utils";
import { ttrpgRoomPageMarkdown } from "./ttrpg-room-page-markdown";

const render = async (
  locale: (typeof locales)[number],
  meetingRoomPublished = true
) =>
  serializeMarkdown(
    await Effect.runPromise(
      ttrpgRoomPageMarkdown(locale, {
        isPublished: (pathname) =>
          pathname !== "/meeting-room" || meetingRoomPublished,
      })
    )
  );

// Left out on purpose: the metadata title and description, which the page
// sends as metadata, and the photo carousels (ttrpgRoomCarouselOpen,
// ttrpgRoomPhotosComingSoon). The Bar's prefilled contact message
// (ttrpgRoomBarPrefillMessage) only appears in its link.
describe.each(locales)("ttrpgRoomPageMarkdown in %s", (locale) => {
  test("shows the lead, each room with its venue, capacity, description and call to action, then the session notes", async () => {
    const markdown = await render(locale);

    expect(markdownPlainText(markdown)).toBe(
      [
        m.ttrpgRoomHeroTitle({}, { locale }),
        m.ttrpgRoomHeroLead({}, { locale }),
        m.ttrpgRoomBarChoiceTitle({}, { locale }),
        m.ttrpgRoomBarRoomLabel({}, { locale }),
        m.ttrpgRoomBarCapacity({}, { locale }),
        m.ttrpgRoomBarChoiceText({}, { locale }),
        m.ttrpgRoomBarCta({}, { locale }),
        m.ttrpgRoomWorkspaceChoiceTitle({}, { locale }),
        m.ttrpgRoomWorkspaceRoomLabel({}, { locale }),
        m.ttrpgRoomWorkspaceCapacity({}, { locale }),
        m.ttrpgRoomWorkspaceChoiceText({}, { locale }),
        m.ttrpgRoomWorkspaceCta({}, { locale }),
        m.ttrpgRoomGalleryTitle({}, { locale }),
        m.ttrpgRoomGalleryText({}, { locale }),
        `${m.ttrpgRoomBookingNote({}, { locale })} ${m.ttrpgRoomBookingNoteLink({}, { locale })}`,
        messagePlainText(m.ttrpgRoomMeetingRoomNote({}, { locale })),
      ].join("\n")
    );
    expect(markdown).toStartWith(`# ${m.ttrpgRoomHeroTitle({}, { locale })}`);
  });

  test("links the Bar room to its prefilled contact form, the Workspace room to booking and the notes to contact and the meeting room", async () => {
    const [barUrl, workspaceUrl, ...rest] = markdownLinkUrls(
      await render(locale)
    );
    const barContact = new URL(barUrl ?? "");

    expect(rest).toEqual([
      "https://workspace.deskohub.cz/contact",
      "https://workspace.deskohub.cz/meeting-room",
    ]);
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

  test("leaves out the meeting room note while that page is unpublished", async () => {
    const markdown = await render(locale, false);

    expect(markdownLinkUrls(markdown)).not.toContain(
      "https://workspace.deskohub.cz/meeting-room"
    );
    expect(markdownPlainText(markdown)).not.toContain(
      messagePlainText(m.ttrpgRoomMeetingRoomNote({}, { locale }))
    );
  });
});
