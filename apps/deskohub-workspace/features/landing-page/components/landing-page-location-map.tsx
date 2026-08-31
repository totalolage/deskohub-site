"use client";

import { MapPin } from "lucide-react";
import dynamic from "next/dynamic";

const LandingPageInteractiveMap = dynamic(
  () =>
    import("./landing-page-interactive-map").then(
      (mod) => mod.LandingPageInteractiveMap
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#e9e3d6]">
        <MapPin
          aria-hidden="true"
          className="h-12 w-12 animate-pulse text-navy-blue/30"
        />
      </div>
    ),
  }
);

type LandingPageLocationMapProps = {
  label: string;
};

export function LandingPageLocationMap({ label }: LandingPageLocationMapProps) {
  return (
    <section
      aria-label={label}
      className="pointer-events-auto absolute inset-0 isolate z-0"
    >
      <LandingPageInteractiveMap />
    </section>
  );
}
