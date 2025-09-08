"use client";

import { MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { getLocale, m } from "@/features/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";
import { siteConstants } from "@/shared/utils/constants";
import {
  getLocalizedCountryName,
  getTranslatedCityName,
} from "@/shared/utils/geo-formatting";

// Dynamic import for Leaflet (client-side only)
const InteractiveMap = dynamic(
  () => import("./interactive-map").then((mod) => mod.InteractiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-96 bg-gray-800 rounded-lg flex items-center justify-center">
        <div className="text-center text-gray-400">
          <MapPin className="w-12 h-12 mx-auto mb-4 animate-pulse" />
          <p className="text-lg">{m["contact.mapPlaceholder"]()}</p>
        </div>
      </div>
    ),
  }
);

interface ContactMapProps {
  showTitle?: boolean;
  showCard?: boolean;
}

export function ContactMap({
  showTitle = true,
  showCard = true,
}: ContactMapProps = {}) {
  const locale = getLocale();
  const { address } = siteConstants.contact;

  // Build the full address dynamically with translations
  const cityName = getTranslatedCityName(address.city, locale);
  const countryName = getLocalizedCountryName(address.countryCode, locale);
  const fullAddress = `${address.street}, ${address.postalCode} ${cityName} ${address.cityDistrict}, ${countryName}`;

  const mapContent = <InteractiveMap locale={locale} address={fullAddress} />;

  if (!showTitle && !showCard) {
    return mapContent;
  }

  return (
    <div id="map-section" className={showTitle ? "mt-16" : ""}>
      {showTitle && (
        <h2 className="text-3xl font-bold text-white mb-8 text-center">
          {m["contact.mapTitle"]()}
        </h2>
      )}
      {showCard ? (
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-0">{mapContent}</CardContent>
        </Card>
      ) : (
        mapContent
      )}
    </div>
  );
}
