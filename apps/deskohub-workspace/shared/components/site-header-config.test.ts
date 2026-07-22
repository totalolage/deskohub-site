import { describe, expect, test } from "bun:test";
import { getSiteHeaderConfig } from "./site-header-config";

describe("getSiteHeaderConfig", () => {
  test("omits the Meeting Room link when its release flag is disabled", () => {
    const config = getSiteHeaderConfig("cs-CZ", {
      meetingRoomPageEnabled: false,
    });

    expect(config.links).not.toContainEqual(
      expect.objectContaining({ href: "/cs-CZ/meeting-room" })
    );
  });

  test("includes the Meeting Room link when its release flag is enabled", () => {
    const config = getSiteHeaderConfig("en-US", {
      meetingRoomPageEnabled: true,
    });

    expect(config.links).toContainEqual(
      expect.objectContaining({ href: "/en-US/meeting-room" })
    );
  });
});
