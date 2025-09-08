"use client";

import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Navigation } from "lucide-react";
import { m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { siteConstants } from "@/shared/utils/constants";

// Fix for default markers in React-Leaflet
// biome-ignore lint/suspicious/noExplicitAny: Leaflet's type definitions don't expose _getIconUrl, but it's necessary to override for custom markers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});

// Custom marker icon
const customIcon = new L.Icon({
  iconUrl: `data:image/svg+xml;base64,${btoa(`
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#10b981"/>
    </svg>
  `)}`,
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40],
});

// Map controls to fit the view
function MapController() {
  const map = useMap();

  useEffect(() => {
    // Ensure the map fits to the marker
    map.setView(
      [
        siteConstants.contact.coordinates.lat,
        siteConstants.contact.coordinates.lng,
      ],
      16
    );
  }, [map]);

  return null;
}

interface InteractiveMapProps {
  locale: string;
  address: string;
}

export function InteractiveMap({ address }: InteractiveMapProps) {
  const handleGetDirections = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${siteConstants.contact.coordinates.lat},${siteConstants.contact.coordinates.lng}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="h-96 rounded-lg overflow-hidden relative">
      <MapContainer
        center={[
          siteConstants.contact.coordinates.lat,
          siteConstants.contact.coordinates.lng,
        ]}
        zoom={16}
        scrollWheelZoom={false}
        className="h-full w-full"
        attributionControl={true}
      >
        <MapController />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          position={[
            siteConstants.contact.coordinates.lat,
            siteConstants.contact.coordinates.lng,
          ]}
          icon={customIcon}
        >
          <Popup>
            <div className="p-2 min-w-[200px]">
              <h3 className="font-bold text-lg mb-1">DeskoHub</h3>
              <p className="text-sm text-gray-600 mb-3">{address}</p>
              <Button
                size="sm"
                className="w-full bg-green-500 hover:bg-green-600"
                onClick={handleGetDirections}
              >
                <Navigation className="w-4 h-4 mr-2" />
                {m["contact.getDirections"]?.() || "Get Directions"}
              </Button>
            </div>
          </Popup>
        </Marker>
      </MapContainer>

      {/* Overlay button for directions */}
      <Button
        className="absolute top-4 right-4 z-[1000] bg-white text-black hover:bg-gray-100 shadow-md"
        size="sm"
        onClick={handleGetDirections}
      >
        <Navigation className="w-4 h-4 mr-2" />
        {m["contact.getDirections"]?.() || "Get Directions"}
      </Button>
    </div>
  );
}
