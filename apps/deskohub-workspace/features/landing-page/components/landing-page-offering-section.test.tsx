import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { locales, m } from "@/features/i18n";
import {
  getCoworkReservationPath,
  getMeetingRoomReservationPath,
} from "@/features/reservation/routes";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const isMeetingRoomPageEnabled = mock();
const isOfficePageEnabled = mock();

const meetingRoomPageReleaseGate = await import(
  "@/features/meeting-room/backend/meeting-room-page-release-gate.server"
);
mock.module(
  "@/features/meeting-room/backend/meeting-room-page-release-gate.server",
  () => ({ ...meetingRoomPageReleaseGate, isMeetingRoomPageEnabled })
);
const officeReleaseGate = await import(
  "@/features/office/backend/office-release-gate.server"
);
mock.module("@/features/office/backend/office-release-gate.server", () => ({
  ...officeReleaseGate,
  isOfficePageEnabled,
}));

const { LandingPageOfferingSection } = await import(
  "./landing-page-offering-section"
);

const renderSection = async (
  locale: (typeof locales)[number],
  flags: { readonly meetingRoomPage: boolean; readonly officePage: boolean }
) => {
  isMeetingRoomPageEnabled.mockResolvedValue(flags.meetingRoomPage);
  isOfficePageEnabled.mockResolvedValue(flags.officePage);
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    await LandingPageOfferingSection({ locale })
  );
  return container;
};

const hrefs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("a"), (link) =>
    link.getAttribute("href")
  );

beforeAll(registerWorkspaceComponentTestEnv);
afterAll(unregisterWorkspaceComponentTestEnv);

describe.each(locales)("LandingPageOfferingSection in %s", (locale) => {
  beforeEach(() => {
    isMeetingRoomPageEnabled.mockReset();
    isOfficePageEnabled.mockReset();
  });

  test("links each offer to its booking or detail page", async () => {
    const container = await renderSection(locale, {
      meetingRoomPage: true,
      officePage: true,
    });

    expect(hrefs(container)).toEqual([
      `/${locale}/pricing`,
      getCoworkReservationPath(locale),
      `/${locale}/coworking`,
      getMeetingRoomReservationPath(locale),
      `/${locale}/meeting-room`,
      `/${locale}/ttrpg-room`,
      `/${locale}/contact`,
    ]);
    expect(isMeetingRoomPageEnabled).toHaveBeenCalledTimes(1);
    expect(isOfficePageEnabled).toHaveBeenCalledTimes(1);
  });

  test("leaves out the meeting room page link while that page is off", async () => {
    const container = await renderSection(locale, {
      meetingRoomPage: false,
      officePage: true,
    });

    expect(hrefs(container)).not.toContain(`/${locale}/meeting-room`);
    expect(hrefs(container)).toContain(getMeetingRoomReservationPath(locale));
  });

  test("mentions private offices only while the office page is off", async () => {
    const offices = m.landingOfferingOffices({}, { locale });
    const withOfficePage = await renderSection(locale, {
      meetingRoomPage: true,
      officePage: true,
    });
    const withoutOfficePage = await renderSection(locale, {
      meetingRoomPage: true,
      officePage: false,
    });

    expect(withOfficePage.textContent).not.toContain(offices);
    expect(withoutOfficePage.textContent).toContain(offices);
  });
});
