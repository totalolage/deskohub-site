import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

export function useScreenSize() {
  const [screenSize, setScreenSize] = React.useState<{
    width: number;
    height: number;
    isMobileScreen: boolean;
    isTabletScreen: boolean;
    isDesktopScreen: boolean;
  }>({
    width: 0,
    height: 0,
    isMobileScreen: false,
    isTabletScreen: false,
    isDesktopScreen: false,
  });

  React.useEffect(() => {
    const updateScreenSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      setScreenSize({
        width,
        height,
        isMobileScreen: width < MOBILE_BREAKPOINT,
        isTabletScreen: width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT,
        isDesktopScreen: width >= TABLET_BREAKPOINT,
      });
    };

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", updateScreenSize);
    updateScreenSize();

    return () => mql.removeEventListener("change", updateScreenSize);
  }, []);

  return screenSize;
}

// For backwards compatibility
export function useIsMobileScreen() {
  const { isMobileScreen } = useScreenSize();
  return isMobileScreen;
}
