"use client";

import L from "leaflet";
import { useEffect, useEffectEvent, useRef } from "react";
import "leaflet/dist/leaflet.css";
import {
  workspaceLocationMapZoom,
  workspaceSiteConstants,
} from "@/shared/utils";
import {
  locationMapMarker,
  locationMapMarkerPosition,
  locationMapWideMedia,
} from "../location-map";

const workspaceCoordinates = workspaceSiteConstants.location.coordinates;

function getMarkerViewportOffset(size: L.Point, wideFraming: boolean) {
  const position = locationMapMarkerPosition[wideFraming ? "wide" : "narrow"];
  return L.point(
    Math.round(size.x * (position.x - 0.5)),
    Math.round(size.y * (position.y - 0.5))
  );
}

const workspaceMarkerIcon = L.divIcon({
  className: "",
  html: locationMapMarker.svg,
  iconAnchor: [locationMapMarker.anchor.x, locationMapMarker.anchor.y],
  iconSize: [locationMapMarker.size, locationMapMarker.size],
});

type LandingPageInteractiveMapProps = {
  /** Runs once the map is set up in `container`, before its tiles load. */
  onMount?: (container: HTMLElement) => void;
  /** Runs whenever the view starts to move, after the initial framing. */
  onMoveStart?: () => void;
  /** Runs when every tile in view has loaded without an error. */
  onTilesLoad?: () => void;
};

export function LandingPageInteractiveMap({
  onMount,
  onMoveStart,
  onTilesLoad,
}: LandingPageInteractiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const handleMount = useEffectEvent((container: HTMLElement) =>
    onMount?.(container)
  );
  const handleMoveStart = useEffectEvent(() => onMoveStart?.());
  const handleTilesLoad = useEffectEvent(() => onTilesLoad?.());

  useEffect(() => {
    const container = mapContainerRef.current!;
    const map = L.map(container, {
      dragging: false,
      // Tiles pop in over the static map, which shows the same pixels.
      fadeAnimation: false,
      scrollWheelZoom: false,
    }).setView(
      [workspaceCoordinates.lat, workspaceCoordinates.lng],
      workspaceLocationMapZoom
    );
    L.marker([workspaceCoordinates.lat, workspaceCoordinates.lng], {
      icon: workspaceMarkerIcon,
      interactive: false,
      keyboard: false,
    }).addTo(map);

    const wideFraming = window.matchMedia(locationMapWideMedia);

    const frameMarker = () => {
      if (wideFraming.matches) {
        map.dragging.enable();
      } else {
        map.dragging.disable();
      }

      const zoom = map.getZoom();
      const markerPoint = map.project(
        [workspaceCoordinates.lat, workspaceCoordinates.lng],
        zoom
      );
      map.setView(
        map.unproject(
          markerPoint.subtract(
            getMarkerViewportOffset(map.getSize(), wideFraming.matches)
          ),
          zoom
        ),
        zoom,
        { animate: false }
      );
    };

    // Framed before the tiles are added, so only the framed view's tiles load.
    frameMarker();
    let tileFailed = false;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      // OpenStreetMap blocks browser tile requests without a Referer. The
      // site-wide no-referrer policy would strip it, so tiles send the origin.
      referrerPolicy: "strict-origin",
    })
      .on("loading", () => {
        tileFailed = false;
      })
      .on("tileerror", () => {
        tileFailed = true;
      })
      // Leaflet also reports a load when some tiles failed.
      .on("load", () => {
        if (!tileFailed) handleTilesLoad();
      })
      .addTo(map);
    map.on("movestart", () => handleMoveStart());
    map.on("resize", frameMarker);
    wideFraming.addEventListener("change", frameMarker);
    handleMount(container);
    return () => {
      map.off("resize", frameMarker);
      wideFraming.removeEventListener("change", frameMarker);
      map.remove();
    };
  }, []);

  // Transparent, so the static map shows through until the tiles cover it.
  return (
    <div
      ref={mapContainerRef}
      className="h-full w-full"
      style={{ background: "transparent" }}
    />
  );
}
