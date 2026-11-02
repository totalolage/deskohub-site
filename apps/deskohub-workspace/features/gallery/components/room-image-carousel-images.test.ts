import { describe, expect, test } from "bun:test";
import type { StaticImageData } from "next/image";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import { roomCarouselImages } from "./room-image-carousel-images";

const staticImage = (name: string): StaticImageData => ({
  height: 600,
  src: `/${name}.jpg`,
  width: 800,
});

const venuePhoto = (id: string, caption?: string): VenuePhoto => ({
  alt: `Room ${id}`,
  ...(caption !== undefined && { caption }),
  height: 900,
  id,
  lightbox: {
    alt: `Room ${id}`,
    height: 1800,
    src: `https://example.test/${id}-large.jpg`,
    width: 2400,
  },
  publicId: `rooms/${id}`,
  src: `https://example.test/${id}.jpg`,
  width: 1200,
});

const openLabel = "Open room photo";

describe("roomCarouselImages", () => {
  test("shows the venue photos from Cloudinary, labelled by caption or alt", () => {
    const captioned = venuePhoto("one", "Window seats");
    const uncaptioned = venuePhoto("two", "");

    expect(
      roomCarouselImages({
        images: [captioned, uncaptioned],
        openLabel,
        fallbackImages: [{ alt: "Ignored", src: staticImage("ignored") }],
      })
    ).toEqual([
      {
        alt: "Room one",
        caption: "Window seats",
        height: 900,
        id: "one",
        kind: "cloudinary",
        label: "Window seats",
        source: "rooms/one",
        lightbox: captioned.lightbox,
        width: 1200,
      },
      {
        alt: "Room two",
        caption: "",
        height: 900,
        id: "two",
        kind: "cloudinary",
        label: "Room two",
        source: "rooms/two",
        lightbox: uncaptioned.lightbox,
        width: 1200,
      },
    ]);
  });

  test("falls back to static images, labelled by trimmed caption, trimmed alt, or position", () => {
    const images = roomCarouselImages({
      images: [],
      openLabel,
      fallbackImages: [
        { alt: "Desk", caption: "  Quiet corner  ", src: staticImage("a") },
        { alt: "  Lounge  ", caption: "   ", src: staticImage("b") },
        { alt: "  ", src: staticImage("c") },
      ],
    });

    expect(images.map(({ label }) => label)).toEqual([
      "Quiet corner",
      "Lounge",
      `${openLabel} 3`,
    ]);
    expect(images[0]).toEqual({
      alt: "Desk",
      caption: "  Quiet corner  ",
      height: 600,
      id: "/a.jpg",
      kind: "static",
      label: "Quiet corner",
      source: staticImage("a"),
      lightbox: {
        alt: "Desk",
        description: "  Quiet corner  ",
        height: 600,
        src: "/a.jpg",
        title: "  Quiet corner  ",
        width: 800,
      },
      width: 800,
    });
  });

  test("prefers the fallback image list over a single fallback image", () => {
    expect(
      roomCarouselImages({
        images: [],
        openLabel,
        fallbackImages: [],
        fallbackImage: staticImage("single"),
      })
    ).toEqual([]);
  });

  test.each<[string, string | undefined, string, string]>([
    ["its alt", "Meeting room", "Meeting room", "Meeting room"],
    ["no alt", undefined, "", `${openLabel} 1`],
  ])(
    "shows a single fallback image with %s",
    (_name, fallbackImageAlt, alt, label) => {
      expect(
        roomCarouselImages({
          images: [],
          openLabel,
          fallbackImage: staticImage("single"),
          fallbackImageAlt,
        }).map((image) => [image.id, image.alt, image.label])
      ).toEqual([["/single.jpg", alt, label]]);
    }
  );

  test("has no photos without venue photos or fallbacks", () => {
    expect(roomCarouselImages({ images: [], openLabel })).toEqual([]);
  });
});
