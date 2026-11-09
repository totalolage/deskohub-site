import { describe, expect, test } from "bun:test";
import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { renderToStaticMarkup } from "react-dom/server";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import type { ScheduleEventImages } from "./event-images";
import { cloudinaryAsset } from "./palmovcon-images.test-utils";
import type { ScheduleItem } from "./schedule";
import { getMobileEventImage, ScheduleEventCard } from "./schedule-event-card";

setBoardgameTestEnv();

const desktop = cloudinaryAsset("event");
const mobile = cloudinaryAsset("event-mobile");

const eventImages = (
  image: Partial<ScheduleEventImages["image"]>
): ScheduleEventImages => ({
  image: { desktop: undefined, mobile: undefined, ...image },
  blurDataURL: { desktop: "desktop-blur", mobile: "mobile-blur" },
});

const item: ScheduleItem = {
  title: "Event title",
  time: "10:00",
  description: "Event description",
  imagePublicId: "event",
};

const imagesOf = (props: Parameters<typeof ScheduleEventCard>[0]) =>
  findElementsOfType(ScheduleEventCard(props), CloudinaryImage).map(
    ({ props: { source, blurDataURL, sizes } }) => ({
      source,
      blurDataURL,
      sizes,
    })
  );

const headingOverlaysImage = (markup: string) =>
  /<div class="absolute [^"]*"><p/.test(markup);

describe("getMobileEventImage", () => {
  test("prefers the mobile variant", () => {
    expect(getMobileEventImage(eventImages({ desktop, mobile }))).toEqual({
      source: mobile,
      blurDataURL: "mobile-blur",
    });
  });

  test("falls back to the desktop image", () => {
    expect(getMobileEventImage(eventImages({ desktop }))).toEqual({
      source: desktop,
      blurDataURL: "desktop-blur",
    });
  });

  test("has none without images", () => {
    expect(getMobileEventImage(eventImages({}))).toBeUndefined();
  });
});

describe("ScheduleEventCard", () => {
  test("shows the mobile and desktop images with the heading over them", () => {
    const props = { item, images: eventImages({ desktop, mobile }) };

    expect(imagesOf(props)).toEqual([
      {
        source: mobile,
        blurDataURL: "mobile-blur",
        sizes: "100vw",
      },
      {
        source: desktop,
        blurDataURL: "desktop-blur",
        sizes: "40vw",
      },
    ]);
    expect(
      headingOverlaysImage(
        renderToStaticMarkup(<ScheduleEventCard {...props} />)
      )
    ).toBe(true);
  });

  test("uses the desktop image on mobile without a mobile variant", () => {
    expect(imagesOf({ item, images: eventImages({ desktop }) })).toEqual([
      {
        source: desktop,
        blurDataURL: "desktop-blur",
        sizes: "100vw",
      },
      {
        source: desktop,
        blurDataURL: "desktop-blur",
        sizes: "40vw",
      },
    ]);
  });

  test("shows only the mobile variant without a desktop image", () => {
    expect(imagesOf({ item, images: eventImages({ mobile }) })).toEqual([
      {
        source: mobile,
        blurDataURL: "mobile-blur",
        sizes: "100vw",
      },
    ]);
  });

  test("keeps the heading in the card without images", () => {
    const props = { item, images: eventImages({}) };

    expect(imagesOf(props)).toEqual([]);
    expect(
      headingOverlaysImage(
        renderToStaticMarkup(<ScheduleEventCard {...props} />)
      )
    ).toBe(false);
  });

  test("links the registration and shows the note", () => {
    const markup = renderToStaticMarkup(
      <ScheduleEventCard
        images={eventImages({})}
        item={{
          ...item,
          cta: { href: "https://forms.example.test/register", label: "Go" },
          note: "Bring your own deck",
        }}
      />
    );

    expect(markup).toContain(
      '<a href="https://forms.example.test/register" rel="noreferrer" target="_blank"'
    );
    expect(markup).toContain("Bring your own deck");
  });

  test("shows the note without a registration link", () => {
    const markup = renderToStaticMarkup(
      <ScheduleEventCard
        images={eventImages({})}
        item={{ ...item, note: "Bring your own deck" }}
      />
    );

    expect(markup).not.toContain("<a ");
    expect(markup).toContain("Bring your own deck");
  });

  test("has no actions without a registration link or note", () => {
    const markup = renderToStaticMarkup(
      <ScheduleEventCard images={eventImages({})} item={item} />
    );

    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("lg:items-end");
  });
});
