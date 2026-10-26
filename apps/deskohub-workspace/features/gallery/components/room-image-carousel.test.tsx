import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { StaticImageData } from "next/image";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: ({ alt }: { alt: string }) => (
    <span aria-label={alt} role="img" />
  ),
}));

mock.module("next/image", () => ({
  default: () => null,
}));

mock.module("yet-another-react-lightbox", () => ({
  default: ({
    index,
    open,
    slides,
  }: {
    index: number;
    open: boolean;
    slides: readonly { alt?: string }[];
  }) => (
    <output data-index={index} data-open={open} data-testid="lightbox">
      {slides.map((slide) => slide.alt).join("|")}
    </output>
  ),
}));

const testImages: readonly StaticImageData[] = [
  {
    height: 600,
    src: "/meeting-room-first.jpg",
    width: 800,
  },
  {
    height: 600,
    src: "/meeting-room-second.jpg",
    width: 800,
  },
];

const cloudinaryImages = [
  {
    context: {
      custom: { "alt-cs-CZ": "Czech alt", "alt-en-US": "Localized alt" },
    },
    height: 600,
    public_id: "room-one",
    secure_url: "https://example.test/room-one.jpg",
    width: 800,
  },
  {
    context: { custom: { alt: " " } },
    height: 600,
    public_id: "room-two",
    secure_url: "https://example.test/room-two.jpg",
    width: 800,
  },
] as readonly CloudinaryAsset[];

const createPointerEvent = ({
  buttons,
  clientX,
  clientY,
  type,
}: {
  buttons: number;
  clientX: number;
  clientY: number;
  type: string;
}) => {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons,
    cancelable: true,
    clientX,
    clientY,
    isPrimary: true,
    pointerId: 1,
    pointerType: "touch",
  });

  Object.defineProperties(event, {
    pageX: { configurable: true, value: clientX },
    pageY: { configurable: true, value: clientY },
  });

  return event;
};

describe("RoomImageCarousel", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("describes Cloudinary photos with localized or fallback alts and numbered controls", async () => {
    const { RoomImageCarousel } = await import("./room-image-carousel");
    const view = render(
      <RoomImageCarousel
        emptyText="No photos"
        imageAlt="Room fallback alt"
        images={cloudinaryImages}
        locale="en-US"
        openLabel="Open room gallery"
      />
    );
    const imageAlts = view
      .getAllByRole("img", { hidden: true })
      .map((image) => image.getAttribute("aria-label"));

    expect(new Set(imageAlts)).toEqual(
      new Set(["Localized alt", "Room fallback alt"])
    );
    expect(view.getByTestId("lightbox").textContent).toBe(
      "Localized alt|Room fallback alt"
    );
    expect(
      view.getAllByRole("button", { name: "Open room gallery 2" })
    ).not.toHaveLength(0);
    expect(
      view.queryAllByRole("button", { hidden: true, name: /room-(one|two)/ })
    ).toHaveLength(0);
  });

  test("opens the current fallback photo with the shared lightbox", async () => {
    const { RoomImageCarousel } = await import("./room-image-carousel");
    const view = render(
      <RoomImageCarousel
        emptyText="No photos"
        fallbackImages={testImages.map((src, index) => ({
          alt: `Meeting room ${index + 1}`,
          src,
        }))}
        imageAlt="Meeting room"
        images={[]}
        locale="en-US"
        openLabel="Open meeting room gallery"
      />
    );
    const [currentPhoto] = view.getAllByRole("button", {
      name: "Meeting room 1",
    });

    if (!currentPhoto) throw new Error("Expected current photo");
    expect(view.getByRole("button", { name: "Meeting room 2" })).toBeTruthy();

    fireEvent.click(currentPhoto);

    expect(view.getByTestId("lightbox").dataset.open).toBe("true");
    expect(view.getByTestId("lightbox").dataset.index).toBe("0");
  });

  test("swipes fallback photos through the Motion drag controls", async () => {
    const { RoomImageCarousel } = await import("./room-image-carousel");
    const view = render(
      <RoomImageCarousel
        emptyText="No photos"
        fallbackImages={testImages.map((src, index) => ({
          alt: `Meeting room ${index + 1}`,
          src,
        }))}
        imageAlt="Meeting room"
        images={[]}
        locale="en-US"
        openLabel="Open meeting room gallery"
      />
    );
    const [activePhoto] = view.getAllByRole("button", {
      name: "Meeting room 1",
    });
    const stage = activePhoto?.parentElement;

    if (!stage) throw new Error("Expected gallery stage");

    Object.defineProperty(stage, "clientWidth", {
      configurable: true,
      value: 100,
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(
      view.container
        .querySelector('[aria-current="true"]')
        ?.getAttribute("aria-label")
    ).toBe("Meeting room 1");

    await act(async () => {
      fireEvent(
        stage,
        createPointerEvent({
          buttons: 1,
          clientX: 200,
          clientY: 100,
          type: "pointerdown",
        })
      );
      fireEvent(
        window,
        createPointerEvent({
          buttons: 1,
          clientX: 140,
          clientY: 100,
          type: "pointermove",
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(
      view.container
        .querySelector('[aria-current="true"]')
        ?.getAttribute("aria-label")
    ).toBe("Meeting room 2");

    await act(async () => {
      fireEvent(
        window,
        createPointerEvent({
          buttons: 0,
          clientX: 140,
          clientY: 100,
          type: "pointerup",
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(
      view.container
        .querySelector('[aria-current="true"]')
        ?.getAttribute("aria-label")
    ).toBe("Meeting room 2");
  });
});
