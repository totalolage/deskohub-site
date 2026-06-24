"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import type { ReactNode } from "react";
import { useRef } from "react";

type LandingPageParallaxLayerProps = {
  children?: ReactNode;
  className?: string;
  from: string;
  to: string;
};

export function LandingPageParallaxLayer({
  children,
  className,
  from,
  to,
}: LandingPageParallaxLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [from, to]);

  return (
    <motion.div
      className={className}
      ref={ref}
      style={shouldReduceMotion ? undefined : { y }}
    >
      {children}
    </motion.div>
  );
}
