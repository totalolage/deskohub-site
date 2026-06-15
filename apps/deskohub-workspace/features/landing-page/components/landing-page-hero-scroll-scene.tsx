"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { type ReactNode, useRef } from "react";
import { Container } from "@/shared/components/container";

type LandingPageHeroScrollSceneProps = {
  id: string;
  className?: string;
  background: ReactNode;
  bottomSection: ReactNode;
  children: ReactNode;
};

export function LandingPageHeroScrollScene({
  id,
  className,
  background,
  bottomSection,
  children,
}: LandingPageHeroScrollSceneProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const backgroundY = useTransform(scrollYProgress, [0, 1], ["0vh", "60vh"]);
  const backgroundScale = useTransform(scrollYProgress, [0, 1], [1.04, 1.2]);
  const contentY = useTransform(scrollYProgress, [0, 1], ["0vh", "34vh"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.58], [1, 0]);

  return (
    <section className={className} id={id} ref={sectionRef}>
      <motion.div
        className="absolute inset-x-0 -top-[24dvh] -bottom-[32dvh] -z-1 will-change-transform"
        style={
          shouldReduceMotion
            ? undefined
            : { scale: backgroundScale, y: backgroundY }
        }
      >
        {background}
      </motion.div>

      <Container className="mx-auto flex min-h-[calc(100dvh-var(--site-header-height)-var(--hero-bottom-section-height))] w-full flex-col items-center justify-center pb-28 text-center">
        <motion.div
          className="relative z-1 flex flex-col items-center text-center"
          style={
            shouldReduceMotion
              ? undefined
              : { opacity: contentOpacity, y: contentY }
          }
        >
          {children}
        </motion.div>
      </Container>

      {bottomSection}
    </section>
  );
}
