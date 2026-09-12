"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

type StickySectionProps = {
  readonly children: ReactNode;
};

export function StickySection({ children }: StickySectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const updateHeight = (height: number) => {
      section.style.setProperty("--sticky-section-height", `${height}px`);
    };

    updateHeight(section.getBoundingClientRect().height);

    const observer = new ResizeObserver((entries) => {
      const borderBoxSize = entries[0]?.borderBoxSize[0];
      if (borderBoxSize) updateHeight(borderBoxSize.blockSize);
    });
    observer.observe(section, { box: "border-box" });

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={sectionRef}
      data-slot="sticky-section"
      className="lg:sticky lg:self-start"
      style={{
        top: "min(calc(var(--site-header-height) + 1.5rem), calc(100dvh - var(--sticky-section-height, 0px) - 1.5rem))",
      }}
    >
      {children}
    </div>
  );
}
