"use client";

import { Glass, type GlassProps } from "@samasante/liquid-glass";

export type GlassCardProps = GlassProps;

function GlassCard({ optics, style, ...props }: GlassCardProps) {
  return (
    <Glass
      data-slot="glass-card"
      optics={{ brightness: 0, ...optics }}
      style={{ display: "block", ...style }}
      {...props}
    />
  );
}

export { GlassCard };
