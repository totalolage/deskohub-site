import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
  messagePlainText,
} from "@/shared/markdown/markdown.test-utils";
import { meetingRoomPageMarkdown } from "./meeting-room-page-markdown";

// Left out on purpose: the metadata title and description, which the page
// sends as metadata; the decorative eyebrows (meetingRoomHeroEyebrow,
// meetingRoomSpecificationsEyebrow, meetingRoomGalleryEyebrow); the hero
// image's alt text, its caption overlay (meetingRoomHeroModeLabel,
// meetingRoomHeroModeValue) and the facts list's label
// (meetingRoomFactsLabel); and the photo gallery with its in-page link
// (meetingRoomGalleryCta, meetingRoomGalleryTitle,
// meetingRoomGalleryOpenImage, meetingRoomPhotosComingSoon).
describe.each(locales)("meetingRoomPageMarkdown in %s", (locale) => {
  test("shows the hero, every specification and the booking section in page order", async () => {
    const markdown = serializeMarkdown(
      await Effect.runPromise(meetingRoomPageMarkdown(locale))
    );

    expect(markdownPlainText(markdown)).toBe(
      [
        `${m.meetingRoomHeroTitle({}, { locale })} ${m.meetingRoomHeroTitleAccent({}, { locale })}`,
        m.meetingRoomHeroIntro({}, { locale }),
        m.meetingRoomFactCapacity({}, { locale }),
        m.meetingRoomFactTv({}, { locale }),
        m.meetingRoomFactPrivacy({}, { locale }),
        m.meetingRoomReservationCta({}, { locale }),
        m.meetingRoomSpecificationsTitle({}, { locale }),
        m.meetingRoomSpecificationsIntro({}, { locale }),
        m.meetingRoomSpecCapacityTitle({}, { locale }),
        m.meetingRoomSpecCapacityText({}, { locale }),
        m.meetingRoomSpecTvTitle({}, { locale }),
        m.meetingRoomSpecTvText({}, { locale }),
        m.meetingRoomSpecProjectorTitle({}, { locale }),
        m.meetingRoomSpecProjectorText({}, { locale }),
        m.meetingRoomSpecConferenceTitle({}, { locale }),
        m.meetingRoomSpecConferenceText({}, { locale }),
        m.meetingRoomBookingTitle({}, { locale }),
        messagePlainText(m.meetingRoomBookingText({}, { locale })),
        messagePlainText(m.meetingRoomTtrpgNote({}, { locale })),
        m.meetingRoomReservationCta({}, { locale }),
      ].join("\n")
    );
    expect(markdown).toStartWith("# ");
    expect(markdown).toContain(
      `\n### ${m.meetingRoomSpecConferenceTitle({}, { locale })}\n`
    );
  });

  test("links the reservation calls to action to the booking page and the notes to pricing and the TTRPG room", async () => {
    const markdown = serializeMarkdown(
      await Effect.runPromise(meetingRoomPageMarkdown(locale))
    );

    expect(markdownLinkUrls(markdown)).toEqual([
      "https://workspace.deskohub.cz/reservation/meeting-room",
      "https://workspace.deskohub.cz/pricing",
      "https://workspace.deskohub.cz/ttrpg-room",
      "https://workspace.deskohub.cz/reservation/meeting-room",
    ]);
  });
});
