"use client";

import { Move } from "lucide-react";
import { lazy, type PointerEvent, Suspense, useRef, useState } from "react";
import type { VariableStyle } from "@/shared/utils";
import {
  type LocationMapFraming,
  locationMapFramingPath,
  locationMapFramings,
  locationMapMarker,
  locationMapMarkerPosition,
  locationMapWideMedia,
} from "../location-map";

const loadInteractiveMap = () => import("./landing-page-interactive-map");

// Leaflet and its tiles load only once a visitor asks for the interactive map.
const LandingPageInteractiveMap = lazy(() =>
  loadInteractiveMap().then((mod) => ({
    default: mod.LandingPageInteractiveMap,
  }))
);

const preloadInteractiveMap = () => {
  void loadInteractiveMap();
};

// A touch that lands on the map is usually a scroll, not interest in it.
const preloadInteractiveMapForPointer = ({ pointerType }: PointerEvent) => {
  if (pointerType !== "touch") preloadInteractiveMap();
};

const framingSize = (framing: LocationMapFraming) => {
  const { height, width } = locationMapFramings[framing];
  return { height, width };
};

type LandingPageLocationMapProps = {
  label: string;
  activateLabel: string;
};

export function LandingPageLocationMap({
  label,
  activateLabel,
}: LandingPageLocationMapProps) {
  const [requested, setRequested] = useState(false);
  const [mounted, setMounted] = useState(false);
  // The static map matches the interactive map only until it moves, and is
  // redundant once its tiles cover it.
  const [staticMapShown, setStaticMapShown] = useState(true);
  const hideStaticMap = () => setStaticMapShown(false);
  const activateButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <section
      aria-label={label}
      className="pointer-events-auto absolute inset-0 isolate z-0 overflow-hidden bg-[#f2efe9]"
    >
      {staticMapShown && <LandingPageStaticLocationMap />}
      {requested && (
        <div className="absolute inset-0">
          <Suspense>
            <LandingPageInteractiveMap
              onMount={(container) => {
                // Keyboard users keep their place: focus moves into the map
                // only if it is still on the button that asked for it.
                if (document.activeElement === activateButtonRef.current) {
                  container.focus();
                }
                setMounted(true);
              }}
              onMoveStart={hideStaticMap}
              onTilesLoad={hideStaticMap}
            />
          </Suspense>
        </div>
      )}
      {!mounted && (
        <>
          <button
            ref={activateButtonRef}
            className="group absolute inset-0 cursor-pointer outline-none"
            onClick={() => setRequested(true)}
            onFocus={preloadInteractiveMap}
            onPointerEnter={preloadInteractiveMapForPointer}
            type="button"
          >
            <span className="absolute right-3 bottom-8 inline-flex items-center gap-2 rounded-full border border-navy-blue/15 bg-white/90 px-4 py-2 text-sm font-semibold text-navy-blue shadow-[0_12px_32px_-18px_rgba(0,2,79,0.7)] transition-colors group-hover:bg-white group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-navy-blue">
              <Move aria-hidden="true" className="size-4" />
              {activateLabel}
            </span>
          </button>
          {/* Leaflet shows its own attribution once the map is mounted. */}
          <span className="absolute right-0 bottom-0 bg-white/80 px-[5px] text-xs leading-[1.4] text-[#333]">
            &copy;{" "}
            <a
              className="text-[#0078a8] hover:underline"
              href="https://www.openstreetmap.org/copyright"
            >
              OpenStreetMap
            </a>{" "}
            contributors
          </span>
        </>
      )}
    </section>
  );
}

const percent = (fraction: number) => `${fraction * 100}%`;

const markerImage = `url("data:image/svg+xml,${encodeURIComponent(locationMapMarker.svg)}")`;

/**
 * The map as the interactive map first frames it, at the same scale: the
 * breakpoint's static framing, placed so its workspace pixel and the pin sit
 * at the interactive map's marker position. Each framing's workspace pixel is
 * that same fraction of its own size, so one translate places all of them.
 */
function LandingPageStaticLocationMap() {
  const { narrow, wide } = locationMapMarkerPosition;
  const vars: VariableStyle<
    "narrow-marker-x" | "narrow-marker-y" | "wide-marker-x" | "wide-marker-y"
  > = {
    "--narrow-marker-x": percent(narrow.x),
    "--narrow-marker-y": percent(narrow.y),
    "--wide-marker-x": percent(wide.x),
    "--wide-marker-y": percent(wide.y),
  };

  return (
    <div className="pointer-events-none absolute inset-0" style={vars}>
      <div className="absolute top-(--narrow-marker-y) left-(--narrow-marker-x) lg:top-(--wide-marker-y) lg:left-(--wide-marker-x)">
        <picture>
          <source
            media="(min-width: 120rem)"
            srcSet={locationMapFramingPath("extra-wide")}
            {...framingSize("extra-wide")}
          />
          <source
            media={locationMapWideMedia}
            srcSet={locationMapFramingPath("wide")}
            {...framingSize("wide")}
          />
          <source
            media="(min-width: 32rem)"
            srcSet={locationMapFramingPath("medium")}
            {...framingSize("medium")}
          />
          <img
            {...framingSize("compact")}
            alt=""
            className="absolute max-w-none -translate-x-(--narrow-marker-x) -translate-y-(--narrow-marker-y) lg:-translate-x-(--wide-marker-x) lg:-translate-y-(--wide-marker-y)"
            decoding="async"
            loading="lazy"
            src={locationMapFramingPath("compact")}
          />
        </picture>
        <span
          className="absolute block"
          style={{
            backgroundImage: markerImage,
            height: locationMapMarker.size,
            left: -locationMapMarker.anchor.x,
            top: -locationMapMarker.anchor.y,
            width: locationMapMarker.size,
          }}
        />
      </div>
    </div>
  );
}
