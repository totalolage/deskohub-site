"use client";

import { Glass, type GlassOptics } from "@samasante/liquid-glass";
import type { PropsWithChildren } from "react";

type LandingPageGlassCardProps = PropsWithChildren<{
  className: string;
  optics?: Partial<GlassOptics>;
}>;

export function LandingPageGlassCard({
  children,
  className,
  optics,
}: LandingPageGlassCardProps) {
  return (
    <Glass
      className={className}
      optics={{ brightness: 0, ...optics }}
      style={{ display: "block" }}
    >
      {children}
    </Glass>
  );
}
