import {
  Coffee,
  Dices,
  type LucideIcon,
  MonitorSmartphone,
  Phone,
  UtensilsCrossed,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";
import { type Locale, m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { textLink } from "@/shared/components/ui/text-link";
import { getDeskohubBarPageUrl } from "@/shared/utils";

export function LandingPageAmenitiesSection({ locale }: { locale: Locale }) {
  const amenities: ReadonlyArray<{
    icon: LucideIcon;
    title: string;
    text: ReactNode;
  }> = [
    {
      icon: Wifi,
      title: m.landingAmenityInternetTitle({}, { locale }),
      text: m.landingAmenityInternetText({}, { locale }),
    },
    {
      icon: MonitorSmartphone,
      title: m.landingAmenityWorkstationTitle({}, { locale }),
      text: m.landingAmenityWorkstationText({}, { locale }),
    },
    {
      icon: Coffee,
      title: m.landingAmenityCoffeeTitle({}, { locale }),
      text: m.landingAmenityCoffeeText({}, { locale }),
    },
    {
      icon: UtensilsCrossed,
      title: m.landingAmenityFoodTitle({}, { locale }),
      text: m.landingAmenityFoodText({}, { locale }),
    },
    {
      icon: Phone,
      title: m.landingAmenityCallsTitle({}, { locale }),
      text: m.landingAmenityCallsText({}, { locale }),
    },
    {
      icon: Dices,
      title: m.landingAmenityBarTitle({}, { locale }),
      text: (
        <>
          {m.landingAmenityBarText({}, { locale })}{" "}
          <a
            href={getDeskohubBarPageUrl(locale)}
            className={textLink({ tone: "inverse" })}
          >
            {m.landingFooterBarCta({}, { locale })}
          </a>
        </>
      ),
    },
  ];

  return (
    <section
      aria-labelledby="landing-amenities-heading"
      className="bg-navy-blue text-white"
    >
      <Container className="py-20 sm:py-28">
        <h2
          id="landing-amenities-heading"
          className="text-4xl leading-tight text-balance sm:text-5xl"
        >
          {m.landingAmenitiesTitle({}, { locale })}
        </h2>
        <ul className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {amenities.map(({ icon: Icon, title, text }) => (
            <li key={title} className="border-t border-white/16 pt-6">
              <Icon aria-hidden="true" className="size-6 text-sunset-yellow" />
              <h3 className="mt-4 text-2xl leading-tight">{title}</h3>
              <p className="mt-2 leading-7 text-white/72">{text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
