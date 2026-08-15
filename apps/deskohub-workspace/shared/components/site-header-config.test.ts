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

  test("omits the Meeting Room item when its release flag is disabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links).not.toContainEqual(
      expect.objectContaining({
        id: "meetingRoom",
        href: "/cs-CZ/meeting-room",
      })
    );
    expect(config).not.toHaveProperty("disabledMenuItems");
  });

  test("includes the Meeting Room link when its release flag is enabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(true);
    const config = await getSiteHeaderConfig("en-US");

    expect(config.links).toContainEqual(
      expect.objectContaining({
        id: "meetingRoom",
        href: "/en-US/meeting-room",
      })
    );
    expect(config).not.toHaveProperty("disabledMenuItems");
  });

  test("uses compact English labels for the public navigation", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    const config = await getSiteHeaderConfig("en-US");

    expect(config.accountHref).toBe("/en-US/account");
    expect(config.accountLabel).toBe("Account");

    expect(config.links.map(({ label }) => label)).toEqual([
      "Location",
      "Photos",
      "Team",
      "FAQ",
      "Contact",
    ]);
  });

  test("uses compact Czech labels for the public navigation", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isMeetingRoomPageEnabled.mockResolvedValue(false);
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links.map(({ label }) => label)).toEqual([
      "Poloha",
      "Fotky",
      "Tým",
      "FAQ",
      "Kontakt",
    ]);
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
