"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { trackPageView } from "../utils/gtm-events";

/**
 * Hook to track page views with GTM
 */
export function useGTMPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname) {
      const url = searchParams?.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname;
      trackPageView(url);
    }
  }, [pathname, searchParams]);
}
