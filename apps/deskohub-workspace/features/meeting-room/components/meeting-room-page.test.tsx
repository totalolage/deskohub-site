import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: ({
    alt,
    source,
  }: {
    alt: string;
    source: CloudinaryAsset;
  }) => <span aria-label={alt} data-public-id={source.public_id} role="img" />,
}));

type CloudinaryCustomContext = NonNullable<
  NonNullable<CloudinaryAsset["context"]>["custom"]
>;

const createCloudinaryAsset = (
  publicId: string,
  custom?: CloudinaryCustomContext
): CloudinaryAsset => ({
  created_at: "2026-07-31T00:00:00Z",
  format: "jpg",
  height: 1200,
  public_id: publicId,
  resource_type: "image",
  secure_url: `https://example.test/${publicId}.jpg`,
  url: `http://example.test/${publicId}.jpg`,
  width: 1600,
  ...(custom ? { context: { custom } } : {}),
});

describe("MeetingRoomPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders the localized booking journey and ordered Cloudinary photos", async () => {
    const { MeetingRoomPage } = await import("./meeting-room-page");
    const galleryImages = Array.from({ length: 5 }, (_, index) =>
      createCloudinaryAsset(`meeting-room-gallery-${index + 1}`, {
        "alt-en-US": `Meeting room gallery photo ${index + 1}`,
        "caption-en-US": `Gallery caption ${index + 1}`,
        "detail-en-US": `Gallery detail ${index + 1}`,
      })
    );
    const view = render(
      <MeetingRoomPage
        galleryImages={galleryImages}
        heroImage={createCloudinaryAsset("meeting-room-hero")}
        locale="en-US"
      />
    );

    expect(
      view
        .getByRole("link", { name: "Book the meeting room" })
        .getAttribute("href")
    ).toBe("/en-US/reservation/meeting-room");
    expect(
      view.getByRole("link", { name: "View the gallery" }).getAttribute("href")
    ).toBe("#meeting-room-gallery");
    expect(
      view.getByRole("heading", { level: 1 }).textContent?.replace(/\s+/g, " ")
    ).toBe("Your team has a plan.We have the room.");

    const photos = view.getAllByRole("img");

    expect(photos).toHaveLength(6);
    expect(photos.map((photo) => photo.getAttribute("data-public-id"))).toEqual(
      [
        "meeting-room-hero",
        "meeting-room-gallery-1",
        "meeting-room-gallery-2",
        "meeting-room-gallery-3",
        "meeting-room-gallery-4",
        "meeting-room-gallery-5",
      ]
    );
    expect(photos.at(-1)?.getAttribute("aria-label")).toBe(
      "Meeting room gallery photo 5"
    );
    expect(view.getByText("05 / Gallery caption 5")).toBeTruthy();
    expect(view.getByText("Gallery detail 5")).toBeTruthy();
  });

  test("renders gallery descriptions from Cloudinary asset context", async () => {
    const { MeetingRoomPage } = await import("./meeting-room-page");
    const view = render(
      <MeetingRoomPage
        galleryImages={[
          createCloudinaryAsset("meeting-room-gallery-planning", {
            "alt-cs-CZ": "Tým plánuje u stolu v zasedací místnosti",
            "alt-en-US": "Team planning around the meeting-room table",
            "caption-cs-CZ": "Plánovací workshop",
            "caption-en-US": "Planning workshop",
          }),
        ]}
        locale="en-US"
      />
    );

    expect(
      view.getByRole("img", {
        name: "Team planning around the meeting-room table",
      })
    ).toBeTruthy();
    expect(view.getByText("01 / Planning workshop")).toBeTruthy();
    expect(view.queryByText("01 / A closer look")).toBeNull();
  });

  test("renders intentional empty image states while Cloudinary tags are empty", async () => {
    const { MeetingRoomPage } = await import("./meeting-room-page");
    const view = render(<MeetingRoomPage galleryImages={[]} locale="en-US" />);

    expect(view.queryAllByRole("img")).toHaveLength(0);
    expect(view.getAllByText("Photos coming soon.")).toHaveLength(2);
  });
});
