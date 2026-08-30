"use client";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { workspaceSiteConstants } from "@/shared/utils";

const workspaceCoordinates = workspaceSiteConstants.location.coordinates;

const desktopFramingQuery = "(min-width: 64rem)";

function getMarkerViewportOffset(size: L.Point, desktopFraming: boolean) {
  return desktopFraming
    ? L.point(size.x / 4, 0)
    : L.point(0, Math.round(size.y * 0.3));
}

function MapFramingController() {
  const map = useMap();

  useEffect(() => {
    const desktopFraming = window.matchMedia(desktopFramingQuery);

    const frameMarker = () => {
      const zoom = map.getZoom();
      const markerPoint = map.project(
        [workspaceCoordinates.lat, workspaceCoordinates.lng],
        zoom
      );
      map.setView(
        map.unproject(
          markerPoint.subtract(
            getMarkerViewportOffset(map.getSize(), desktopFraming.matches)
          ),
          zoom
        ),
        zoom,
        { animate: false }
      );
    };

    frameMarker();
    map.on("resize", frameMarker);
    desktopFraming.addEventListener("change", frameMarker);
    return () => {
      map.off("resize", frameMarker);
      desktopFraming.removeEventListener("change", frameMarker);
    };
  }, [map]);

  return null;
}

const workspaceMarkerIcon = L.divIcon({
  className: "",
  html: `<svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 1C12.82 1 7 6.82 7 14C7 23.5 20 39 20 39C20 39 33 23.5 33 14C33 6.82 27.18 1 20 1Z" fill="#b83b06"/>
    <circle cx="20" cy="14" r="5.5" fill="#f4f1ea"/>
  </svg>`,
  iconAnchor: [20, 39],
  iconSize: [40, 40],
});

export function LandingPageInteractiveMap() {
  return (
    <MapContainer
      center={[workspaceCoordinates.lat, workspaceCoordinates.lng]}
      className="h-full w-full"
      scrollWheelZoom={false}
      zoom={17}
    >
      <MapFramingController />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker
        icon={workspaceMarkerIcon}
        interactive={false}
        keyboard={false}
        position={[workspaceCoordinates.lat, workspaceCoordinates.lng]}
      />
    </MapContainer>
  );
}
