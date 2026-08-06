import { beforeEach, describe, expect, mock, test } from "bun:test";

const isMeetingRoomPageEnabled = mock();
const isOfficePageEnabled = mock();

mock.module(
  "@/features/meeting-room/backend/meeting-room-page-feature-flag",
  () => ({ isMeetingRoomPageEnabled })
);
mock.module(
  "@/features/office/backend/office-reservation-feature-flag.server",
  () => ({
    isOfficePageEnabled,
  })
);

describe("getSiteHeaderConfig", () => {
  beforeEach(() => {
    isMeetingRoomPageEnabled.mockReset();
    isOfficePageEnabled.mockReset();
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    isOfficePageEnabled.mockResolvedValue(false);
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

  test("omits the Private Office link when its release flag is disabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links).not.toContainEqual(
      expect.objectContaining({ href: "/cs-CZ/reservation/office" })
    );
  });

  test("includes the Private Office link when its release flag is enabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isOfficePageEnabled.mockResolvedValue(true);
    const config = await getSiteHeaderConfig("en-US");

    expect(config.links).toContainEqual(
      expect.objectContaining({ href: "/en-US/reservation/office" })
    );
  });
});
