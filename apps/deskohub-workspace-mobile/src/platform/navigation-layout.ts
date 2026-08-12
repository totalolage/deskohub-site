type SafeAreaInsets = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}>;

type NavigationState = Readonly<{
  loadState: "loading" | "ready" | "error";
  pathname: string;
  sessionKind: "signed_in" | "signed_out";
}>;

export function isTabNavigationHidden({
  loadState,
  pathname,
  sessionKind,
}: NavigationState) {
  return (
    loadState !== "ready" ||
    sessionKind === "signed_out" ||
    pathname.includes("/payment/")
  );
}

export function getTabBarLayout({
  hidden,
  insets,
  wide,
}: {
  hidden: boolean;
  insets: SafeAreaInsets;
  wide: boolean;
}): {
  display: "flex" | "none";
  height?: number;
  paddingBottom?: number;
  paddingTop: number;
  width?: number;
} {
  if (wide) {
    return {
      display: hidden ? "none" : "flex",
      paddingTop: 16 + insets.top,
      width: 128,
    };
  }

  return {
    display: hidden ? "none" : "flex",
    height: 64 + insets.bottom,
    paddingBottom: 4 + insets.bottom,
    paddingTop: 4,
  };
}

export function getScreenSafeAreaEdges({
  navigationHidden,
  wide,
}: {
  navigationHidden: boolean;
  wide: boolean;
}): ("top" | "right" | "bottom" | "left")[] {
  return navigationHidden || wide
    ? ["top", "right", "bottom", "left"]
    : ["top", "right", "left"];
}
