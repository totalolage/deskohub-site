"use client";

import { MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { getLocale, m } from "@/i18n";
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

export function ContactMap() {
  const locale = getLocale();
  const { address } = siteConstants.contact;

  // Build the full address dynamically with translations
  const cityName = getTranslatedCityName(address.city, locale);
  const countryName = getLocalizedCountryName(address.countryCode, locale);
  const fullAddress = `${address.street}, ${address.postalCode} ${cityName} ${address.cityDistrict}, ${countryName}`;

  return (
    <div className="mt-16">
      <h2 className="text-3xl font-bold text-white mb-8 text-center">
        {m["contact.mapTitle"]()}
      </h2>
      <Card className="bg-gray-900 border-gray-700">
        <CardContent className="p-0">
          <InteractiveMap locale={locale} address={fullAddress} />
        </CardContent>
      </Card>
    </div>
  );
}
