import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

type ImageSearch = {
  maxResults?: number;
  sortBy?: string;
  sortDirection?: string;
  tags: unknown;
};

const imageSearches: ImageSearch[] = [];

mock.module("@/features/gallery/actions/get-cloudinary-images", () => ({
  getCloudinaryImages: (search: ImageSearch) => {
    imageSearches.push(search);
    return Promise.resolve([]);
  },
}));

mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({
    isMeetingRoomPageEnabled: () => Promise.resolve(true),
  })
);

mock.module("@/features/meeting-room/components/meeting-room-page", () => ({
  MeetingRoomPage: () => null,
}));

describe("LocalizedMeetingRoomPage", () => {
  beforeEach(() => {
    imageSearches.length = 0;
  });

  test("loads every tagged gallery image in stable public ID order", async () => {
    const { default: LocalizedMeetingRoomPage } = await import("./page");

    await LocalizedMeetingRoomPage();

    expect(imageSearches).toContainEqual({
      sortBy: "public_id",
      sortDirection: "asc",
      tags: "meeting-room-gallery",
    });
  });
});
