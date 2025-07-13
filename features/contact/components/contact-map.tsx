import { MapPin } from "lucide-react";
import { getLocale, m } from "@/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";
import { siteConstants } from "@/shared/utils/constants";
import {
  getLocalizedCountryName,
  getTranslatedCityName,
} from "@/shared/utils/geo-formatting";

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
          <div className="h-96 bg-gray-800 rounded-lg flex items-center justify-center">
            <div className="text-center text-gray-400">
              <MapPin className="w-12 h-12 mx-auto mb-4" />
              <p className="text-lg">{m["contact.mapPlaceholder"]()}</p>
              <p className="text-sm">
                {m["contact.mapAddress"]({
                  address: fullAddress,
                })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
