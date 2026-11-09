import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const cloudinaryImage = await import("@deskohub/cloudinary-image");
mock.module("@deskohub/cloudinary-image", () => ({
  ...cloudinaryImage,
  CloudinaryImage: ({ alt }: { alt: string }) => (
    <span aria-label={alt} role="img" />
  ),
}));

const lightbox = await import("yet-another-react-lightbox");
mock.module("yet-another-react-lightbox", () => ({
  ...lightbox,
  default: ({
    close,
    index,
    open,
    slides,
  }: {
    close: () => void;
    index: number;
    open: boolean;
    slides: readonly { alt?: string }[];
  }) => (
    <>
      <output
        data-index={index}
        data-open={String(open)}
        data-testid="lightbox"
      >
        {slides.map((slide) => slide.alt).join(";")}
      </output>
      <button data-testid="lightbox-close" onClick={close} type="button" />
    </>
  ),
}));

const locale = "en-US";

const photo = (
  id: string,
  text: Pick<VenuePhoto, "alt" | "caption" | "detail">
): VenuePhoto => ({
  ...text,
  height: 1200,
  id,
  lightbox: {
    alt: text.alt,
    height: 1200,
    src: `https://example.test/${id}-lightbox.jpg`,
    width: 1600,
  },
  publicId: id,
  src: `https://example.test/${id}.jpg`,
  width: 1600,
});

const photos = [
  photo("described", {
    alt: "Described photo",
    caption: "Table",
    detail: "10 seats",
  }),
  photo("captioned", { alt: "", caption: "Screen" }),
  photo("detailed", { alt: "", detail: "Whiteboard" }),
  photo("bare", { alt: "" }),
];

const { MeetingRoomGallery } = await import("./meeting-room-gallery");

describe("MeetingRoomGallery", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("shows the coming-soon notice without photos", () => {
    const view = render(<MeetingRoomGallery images={[]} locale={locale} />);

    expect(view.queryAllByRole("figure")).toHaveLength(0);
    expect(
      view.getByText(m.meetingRoomPhotosComingSoon({}, { locale }))
    ).toBeDefined();
    expect(view.getByTestId("lightbox").dataset.open).toBe("false");
  });

  test("names each photo's button by its alt, its caption or its number", () => {
    const view = render(<MeetingRoomGallery images={photos} locale={locale} />);
    const labels = view
      .getAllByRole("button")
      .filter((button) => button.dataset.testid !== "lightbox-close")
      .map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual([
      m.meetingRoomGalleryOpenImage({ image: "Described photo" }, { locale }),
      m.meetingRoomGalleryOpenImage({ image: "Screen" }, { locale }),
      m.meetingRoomGalleryOpenNumberedImage({ number: 3 }, { locale }),
      m.meetingRoomGalleryOpenNumberedImage({ number: 4 }, { locale }),
    ]);
  });

  test("captions a photo with its numbered caption and its detail, when it has either", () => {
    const view = render(<MeetingRoomGallery images={photos} locale={locale} />);
    const figures = view.getAllByRole("figure");
    const caption = (index: number) =>
      figures[index]?.querySelector("figcaption");

    expect(caption(0)?.querySelector("span")?.textContent).toBe("01 / Table");
    expect(caption(0)?.querySelector("strong")?.textContent).toBe("10 seats");
    expect(caption(1)?.querySelector("span")?.textContent).toBe("02 / Screen");
    expect(caption(1)?.querySelector("strong")).toBeNull();
    expect(caption(2)?.querySelector("span")).toBeNull();
    expect(caption(2)?.querySelector("strong")?.textContent).toBe("Whiteboard");
    expect(caption(3)).toBeNull();
  });

  test("opens the clicked photo in the lightbox and closes it", () => {
    const view = render(<MeetingRoomGallery images={photos} locale={locale} />);
    const lightbox = view.getByTestId("lightbox");

    expect(lightbox.textContent).toBe("Described photo;;;");
    fireEvent.click(
      view.getByRole("button", {
        name: m.meetingRoomGalleryOpenImage({ image: "Screen" }, { locale }),
      })
    );
    expect(lightbox.dataset.open).toBe("true");
    expect(lightbox.dataset.index).toBe("1");

    fireEvent.click(view.getByTestId("lightbox-close"));
    expect(lightbox.dataset.open).toBe("false");
  });
});
