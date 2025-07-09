import * as React from "react";

type DeviceType = "mobile" | "tablet" | "desktop";

interface DeviceInfo {
  type: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
  hasHover: boolean;
}

export function useDeviceType(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = React.useState<DeviceInfo>({
    type: "desktop",
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isTouchDevice: false,
    hasHover: true,
  });

  React.useEffect(() => {
    const detectDevice = () => {
      // Check for touch capability
      const isTouchDevice =
        "ontouchstart" in window || navigator.maxTouchPoints > 0;

      // Check for hover capability (more reliable than user agent)
      const hasHover = window.matchMedia("(hover: hover)").matches;

      // Check pointer type (coarse = touch, fine = mouse)
      const hasCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

      // Combine multiple signals for better detection
      let type: DeviceType;

      if (isTouchDevice && hasCoarsePointer && !hasHover) {
        // Primary input is touch, no hover = mobile/tablet
        const width = window.innerWidth;
        const height = window.innerHeight;
        const isLandscape = width > height;

        // Use screen size as secondary signal for mobile vs tablet
        if (width < 768 || (width < 1024 && !isLandscape)) {
          type = "mobile";
        } else {
          type = "tablet";
        }
      } else if (isTouchDevice && hasHover) {
        // Has both touch and hover = likely convertible laptop
        type = "desktop";
      } else {
        // No touch, has hover = desktop
        type = "desktop";
      }

      setDeviceInfo({
        type,
        isMobile: type === "mobile",
        isTablet: type === "tablet",
        isDesktop: type === "desktop",
        isTouchDevice,
        hasHover,
      });
    };

    // Initial detection
    detectDevice();

    // Listen for changes (orientation, window resize)
    const handleResize = () => detectDevice();
    const handleOrientationChange = () => {
      // Delay to allow orientation change to complete
      setTimeout(detectDevice, 100);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientationChange);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
    };
  }, []);

  return deviceInfo;
}
