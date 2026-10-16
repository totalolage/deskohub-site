import { beforeEach, describe, expect, mock, test } from "bun:test";

const isMeetingRoomPageEnabled = mock();
const isOfficePageEnabled = mock();
const isCustomerSignedIn = mock();
const updateLocalePreference = mock();

mock.module("@/features/account/actions", () => ({
  updateLocalePreference,
}));

mock.module("@/features/account/server/customer-session.server", () => ({
  isCustomerSignedIn,
}));

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
    isCustomerSignedIn.mockReset();
    isMeetingRoomPageEnabled.mockReset();
    isOfficePageEnabled.mockReset();
    isCustomerSignedIn.mockResolvedValue(false);
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

  test("omits the Private Office link when its release flag is disabled", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    const config = await getSiteHeaderConfig("cs-CZ");

    expect(config.links).not.toContainEqual(
      expect.objectContaining({ href: "/cs-CZ/reservation/office" })
    );
  });

  test("points a signed-in customer's account entry at the localized account page", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isCustomerSignedIn.mockResolvedValue(true);

    const en = await getSiteHeaderConfig("en-US");
    expect(await en.account.href).toBe("/en-US/account");
    expect(en.account.label).toBe("Account");

    const cs = await getSiteHeaderConfig("cs-CZ");
    expect(await cs.account.href).toBe("/cs-CZ/account");
    expect(cs.account.label).toBe("Účet");
    expect(isCustomerSignedIn).toHaveBeenCalledWith();
  });

  test("points an anonymous customer's account entry at the localized sign-in page", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");

    const en = await getSiteHeaderConfig("en-US");
    expect(await en.account.href).toBe("/en-US/auth/sign-in");
    expect(en.account.signInHref).toBe("/en-US/auth/sign-in");

    const cs = await getSiteHeaderConfig("cs-CZ");
    expect(await cs.account.href).toBe("/cs-CZ/auth/sign-in");
    expect(cs.account.signInHref).toBe("/cs-CZ/auth/sign-in");
  });

  test("falls back to the sign-in page when the session check fails", async () => {
    const { getSiteHeaderConfig } = await import("./site-header-config");
    isCustomerSignedIn.mockRejectedValue(new Error("session unavailable"));

    const config = await getSiteHeaderConfig("en-US");

    expect(await config.account.href).toBe("/en-US/auth/sign-in");
  });

  test("treats a failed session check as a guest switch", async () => {
    const { createLocalePreferenceSaving } = await import(
      "./site-header-config"
    );
    isCustomerSignedIn.mockRejectedValue(new Error("synthetic failure"));

    expect(await createLocalePreferenceSaving().signedIn).toBe(false);
  });
});
