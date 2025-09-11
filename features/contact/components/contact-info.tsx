import { Clock, HelpCircle, Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { getLocale, m } from "@/features/i18n";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { siteConstants } from "@/shared/utils/constants";
import {
  getLocalizedCountryName,
  getTranslatedCityName,
} from "@/shared/utils/geo-formatting";
import { formatPhoneNumber } from "@/shared/utils/phone-formatting";
import {
  getWeekdayHours,
  getWeekendHours,
} from "@/shared/utils/working-hours-helpers";

export function ContactInfo() {
  const locale = getLocale();

  return (
    <div className="space-y-8">
      <h2 className="text-3xl font-bold text-white mb-8">
        {m["contact.infoTitle"]()}
      </h2>

      <div className="space-y-6">
        <Card className="bg-gray-900 border-gray-700" asChild>
          <Link href="#map-section" className="block">
            <CardContent className="p-6 flex items-start space-x-4">
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
            </CardContent>
          </Link>
        </Card>

        <Card className="bg-gray-900 border-gray-700" asChild>
          <Link href={`tel:${siteConstants.contact.phone}`} className="block">
            <CardContent className="p-6 flex items-start space-x-4">
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
            </CardContent>
          </Link>
        </Card>

        <Card className="bg-gray-900 border-gray-700" asChild>
          <Link
            href={`mailto:${siteConstants.contact.infoEmail}`}
            className="block"
          >
            <CardContent className="p-6 flex items-start space-x-4">
              <Mail className="w-6 h-6 text-green-400 mt-1" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {m["contact.emailLabel"]()}
                </h3>
                <p className="text-gray-300">
                  {m["contact.emailAddress"]({
                    email: siteConstants.contact.infoEmail,
                  })}
                </p>
              </div>
            </CardContent>
          </Link>
        </Card>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="bg-gray-900 border-gray-700 relative cursor-help">
                <CardContent className="p-6 flex items-start space-x-4">
                  <Clock className="w-6 h-6 text-green-400 mt-1" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {m["contact.hoursLabel"]()}
                    </h3>
                    <div className="text-gray-300 space-y-1">
                      <div className="flex justify-between gap-2">
                        <span>{m["contact.weekdays"]()}</span>
                        <span>
                          {m["contact.weekdayHours"]({
                            hours: getWeekdayHours().formatted,
                          })}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>{m["contact.weekend"]()}</span>
                        <span>
                          {m["contact.weekendHours"]({
                            hours: getWeekendHours().formatted,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <HelpCircle className="w-4 h-4 text-gray-400 absolute top-4 right-4" />
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-xs bg-gray-800 border-gray-700 text-gray-100"
            >
              <p>{m["contact.hoursTooltip"]()}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
