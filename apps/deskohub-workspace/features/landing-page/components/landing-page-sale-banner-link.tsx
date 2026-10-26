"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  captureSaleBannerClick,
  type LandingPageSaleBannerClick,
} from "../landing-page-sale-banner-analytics";

/** The sale banner's call to action; reports the click, then navigates. */
export function LandingPageSaleBannerLink({
  children,
  click,
  href,
  label,
}: {
  children: ReactNode;
  click: LandingPageSaleBannerClick;
  href: string;
  label: string;
}) {
  return (
    <Button asChild size="md" shape="rounded" caps>
      <Link
        aria-label={label}
        href={href}
        onClick={() => captureSaleBannerClick(click)}
      >
        {children}
      </Link>
    </Button>
  );
}
