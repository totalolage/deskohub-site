import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * @deprecated Use useScreenSize() or useDeviceType() instead for clearer semantics
 * This hook detects screen width, not actual device type
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * More semantically correct name for the same functionality
 * Detects if screen width is below mobile breakpoint
 */
export function useIsMobileScreen() {
  return useIsMobile();
}
