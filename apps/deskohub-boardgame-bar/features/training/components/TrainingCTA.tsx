import { Calendar, Mail, Phone } from "lucide-react";
import { getLocale, LocalizedLink as Link, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { siteConstants } from "@/shared/utils/constants";
import {
  formatPhoneNumber,
  getPhoneLink,
} from "@/shared/utils/phone-formatting";

export const TrainingCTA = async () => {
  const locale = getLocale();
  const boardroomReservationsEnabled =
    siteConstants.featureFlags.boardroomReservations;

  return (
    <section className="py-20 bg-gradient-to-r from-green-600 to-green-700">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            {m["training.cta.title"]()}
          </h2>
          <p className="text-xl text-green-100 mb-12">
            {m["training.cta.description"]({
              email: siteConstants.contact.infoEmail,
              phone: formatPhoneNumber(siteConstants.contact.phone, locale),
            })}
          </p>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
            <a
              href={`tel:${getPhoneLink(siteConstants.contact.phone)}`}
              className="block"
            >
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm hover:bg-white/20 transition-colors">
                <CardContent className="p-6 text-center">
                  <Phone className="w-8 h-8 text-white mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {m["training.cta.call"]()}
                  </h3>
                  <p className="text-green-100">
                    {formatPhoneNumber(siteConstants.contact.phone, locale)}
                  </p>
                </CardContent>
              </Card>
            </a>

            <a
              href={`mailto:${siteConstants.contact.infoEmail}`}
              className="block"
            >
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm hover:bg-white/20 transition-colors">
                <CardContent className="p-6 text-center">
                  <Mail className="w-8 h-8 text-white mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {m["training.cta.write"]()}
                  </h3>
                  <p className="text-green-100">
                    {siteConstants.contact.infoEmail}
                  </p>
                </CardContent>
              </Card>
            </a>

            {boardroomReservationsEnabled ? (
              <Link href="/training-room/reservation" className="block">
                <Card className="bg-white/10 border-white/20 backdrop-blur-sm hover:bg-white/20 transition-colors">
                  <CardContent className="p-6 text-center">
                    <Calendar className="w-8 h-8 text-white mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-white mb-2">
                      {m["training.cta.online"]()}
                    </h3>
                    <p className="text-green-100">
                      {m["training.cta.onlineReservation"]()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ) : (
              <Card className="bg-white/10 border-white/20 backdrop-blur-sm opacity-75">
                <CardContent className="p-6 text-center">
                  <Calendar className="w-8 h-8 text-white mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {m["training.cta.online"]()}
                  </h3>
                  <p className="text-green-100">
                    {m["training.cta.onlineReservation"]()}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {boardroomReservationsEnabled ? (
              <Button
                size="lg"
                className="bg-white text-green-600 hover:bg-gray-100 px-8 py-4 text-lg font-semibold"
                asChild
              >
                <Link href="/training-room/reservation">
                  {m["training.cta.button"]()}
                </Link>
              </Button>
            ) : (
              <Button
                size="lg"
                className="bg-white text-green-600 hover:bg-gray-100 px-8 py-4 text-lg font-semibold"
                asChild
              >
                <Link href="/contact">{m["buttons.contact"]()}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
