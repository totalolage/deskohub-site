import { beforeEach, describe, expect, mock, test } from "bun:test";

const isMeetingRoomPageEnabled = mock();

mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({ isMeetingRoomPageEnabled })
);

describe("getSiteHeaderConfig", () => {
  beforeEach(() => {
    isMeetingRoomPageEnabled.mockReset();
  });

  test("omits the Meeting Room link when its release flag is disabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links).not.toContainEqual(
      expect.objectContaining({ href: "/cs-CZ/meeting-room" })
    );
  });

  test("includes the Meeting Room link when its release flag is enabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(true);
    const config = await getSiteHeaderConfig("en-US");

    expect(config.links).toContainEqual(
      expect.objectContaining({ href: "/en-US/meeting-room" })
    );
  });
});
