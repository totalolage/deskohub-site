"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { trackRoutePageView } from "../utils/gtm-events";

/**
 * Hook to track page views with GTM
 */
export function useGTMPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    trackRoutePageView(pathname, searchParams);
  }, [pathname, searchParams]);
}
