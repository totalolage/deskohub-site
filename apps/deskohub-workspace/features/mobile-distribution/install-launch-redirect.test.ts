import { describe, expect, test } from "bun:test";
import { isMisplacedInstallLaunch } from "./install-launch-redirect";

const homeScreenLaunch = {
  standalone: true,
  historyLength: 1,
  referrer: "",
  pathname: "/cs-CZ/account",
};

describe("isMisplacedInstallLaunch", () => {
  test("a Home Screen launch on a signed-in page belongs in the web app", () => {
    expect(isMisplacedInstallLaunch(homeScreenLaunch)).toBe(true);
    expect(
      isMisplacedInstallLaunch({
        ...homeScreenLaunch,
        pathname: "/en-US/reservation/status/order-1",
      })
    ).toBe(true);
  });

  test("leaves the page alone in a browser tab", () => {
    expect(
      isMisplacedInstallLaunch({ ...homeScreenLaunch, standalone: false })
    ).toBe(false);
  });

  test("leaves the page alone when it was navigated to", () => {
    expect(
      isMisplacedInstallLaunch({ ...homeScreenLaunch, historyLength: 2 })
    ).toBe(false);
    expect(
      isMisplacedInstallLaunch({
        ...homeScreenLaunch,
        referrer: "https://workspace.deskohub.cz/app/",
      })
    ).toBe(false);
  });

  test("never redirects inside the web app", () => {
    for (const pathname of ["/app/", "/app/reservations"]) {
      expect(isMisplacedInstallLaunch({ ...homeScreenLaunch, pathname })).toBe(
        false
      );
    }
  });
});
