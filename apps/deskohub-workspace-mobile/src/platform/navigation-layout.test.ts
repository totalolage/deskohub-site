import { describe, expect, test } from "bun:test";
import {
  getScreenSafeAreaEdges,
  getTabBarLayout,
  isTabNavigationHidden,
} from "./navigation-layout";

const zeroInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe("tab bar safe-area layout", () => {
  test("keeps the compact navigation at its base height without system insets", () => {
    expect(
      getTabBarLayout({ hidden: false, insets: zeroInsets, wide: false })
    ).toMatchObject({
      display: "flex",
      height: 64,
      paddingBottom: 4,
      paddingTop: 4,
    });
  });

  test("adds the bottom system inset to the compact navigation", () => {
    expect(
      getTabBarLayout({
        hidden: false,
        insets: { top: 24, right: 0, bottom: 34, left: 0 },
        wide: false,
      })
    ).toMatchObject({
      display: "flex",
      height: 98,
      paddingBottom: 38,
      paddingTop: 4,
    });
  });

  test("offsets the tablet rail below the status bar without replacing its other insets", () => {
    const layout = getTabBarLayout({
      hidden: false,
      insets: { top: 24, right: 13, bottom: 20, left: 11 },
      wide: true,
    });

    expect(layout).toMatchObject({
      display: "flex",
      paddingTop: 40,
      width: 128,
    });
    expect(layout).not.toHaveProperty("paddingBottom");
    expect(layout).not.toHaveProperty("paddingLeft");
    expect(layout).not.toHaveProperty("paddingRight");
  });

  test("hides navigation without changing the safe-area calculation", () => {
    expect(
      getTabBarLayout({ hidden: true, insets: zeroInsets, wide: false })
    ).toMatchObject({
      display: "none",
      height: 64,
      paddingBottom: 4,
      paddingTop: 4,
    });
  });

  test("protects the bottom edge when the rail is used or navigation is hidden", () => {
    expect(
      getScreenSafeAreaEdges({ navigationHidden: false, wide: false })
    ).toEqual(["top", "right", "left"]);
    expect(
      getScreenSafeAreaEdges({ navigationHidden: false, wide: true })
    ).toContain("bottom");
    expect(
      getScreenSafeAreaEdges({ navigationHidden: true, wide: false })
    ).toContain("bottom");
  });

  test("hides tabs for bootstrap, signed-out, and payment states", () => {
    expect(
      isTabNavigationHidden({
        loadState: "loading",
        pathname: "/",
        sessionKind: "signed_out",
      })
    ).toBe(true);
    expect(
      isTabNavigationHidden({
        loadState: "ready",
        pathname: "/payment/DW-1",
        sessionKind: "signed_in",
      })
    ).toBe(true);
    expect(
      isTabNavigationHidden({
        loadState: "ready",
        pathname: "/",
        sessionKind: "signed_in",
      })
    ).toBe(false);
  });
});
