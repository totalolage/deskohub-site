import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { getLocale, m } from "@/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";
import { siteConstants } from "@/shared/utils/constants";
import {
  getLocalizedCountryName,
  getTranslatedCityName,
} from "@/shared/utils/geo-formatting";
import { formatPhoneNumber } from "@/shared/utils/phone-formatting";

export function ContactInfo() {
  const locale = getLocale();

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold text-white mb-8">
        {m["contact.infoTitle"]()}
      </h2>

      <div className="space-y-6">
        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <MapPin className="w-6 h-6 text-green-400 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {m["contact.addressLabel"]()}
                </h3>
                <p className="text-gray-300">
                  {m["contact.street"]({
                    street: siteConstants.contact.address.street,
                  })}
                  <br />
                  {m["contact.city"]({
                    postalCode: siteConstants.contact.address.postalCode,
                    city: getTranslatedCityName(
                      siteConstants.contact.address.city,
                      locale
                    ),
                    district: siteConstants.contact.address.cityDistrict,
                  })}
                  <br />
                  {getLocalizedCountryName(
                    siteConstants.contact.address.countryCode,
                    locale
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <Phone className="w-6 h-6 text-green-400 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {m["contact.phoneLabel"]()}
                </h3>
                <p className="text-gray-300">
                  {m["contact.phoneNumber"]({
                    phone: formatPhoneNumber(
                      siteConstants.contact.phone,
                      locale
                    ),
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <Mail className="w-6 h-6 text-green-400 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {m["contact.emailLabel"]()}
                </h3>
                <p className="text-gray-300">
                  {m["contact.emailAddress"]({
                    email: siteConstants.contact.email,
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-700">
          <CardContent className="p-6">
            <div className="flex items-start space-x-4">
              <Clock className="w-6 h-6 text-green-400 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {m["contact.hoursLabel"]()}
                </h3>
                <div className="text-gray-300 space-y-1">
                  <div className="flex justify-between">
                    <span>{m["contact.weekdays"]()}</span>
                    <span>
                      {m["contact.weekdayHours"]({
                        hours: siteConstants.workingHours.weekdays.formatted,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{m["contact.weekend"]()}</span>
                    <span>
                      {m["contact.weekendHours"]({
                        hours: siteConstants.workingHours.weekends.formatted,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
