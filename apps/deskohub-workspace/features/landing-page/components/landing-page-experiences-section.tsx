import { CalendarRange } from "lucide-react";
import Link from "next/link";
import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";

type LandingPageExperiencesSectionProps = {
  locale: WorkspaceLocale;
  ttrpgSectionId: string;
  eventsSectionId: string;
  contactHref: string;
};

export function LandingPageExperiencesSection({
  locale,
  ttrpgSectionId,
  eventsSectionId,
  contactHref,
}: LandingPageExperiencesSectionProps) {
  const ttrpgFeatures = [
    {
      label: m.landingTtrpgFeatureOneLabel({}, { locale }),
      text: m.landingTtrpgFeatureOneText({}, { locale }),
    },
    {
      label: m.landingTtrpgFeatureTwoLabel({}, { locale }),
      text: m.landingTtrpgFeatureTwoText({}, { locale }),
    },
    {
      label: m.landingTtrpgFeatureThreeLabel({}, { locale }),
      text: m.landingTtrpgFeatureThreeText({}, { locale }),
    },
  ];

  const eventFeatures = [
    m.landingEventsFeatureOne({}, { locale }),
    m.landingEventsFeatureTwo({}, { locale }),
    m.landingEventsFeatureThree({}, { locale }),
  ];

  return (
    <>
      <section id={ttrpgSectionId} className="bg-[#f4f1ea] py-20 sm:py-24">
        <Container>
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <Badge>{m.landingTtrpgSectionLabel({}, { locale })}</Badge>
              <h2 className="mt-4 text-4xl leading-tight text-balance sm:text-5xl">
                {m.landingTtrpgTitle({}, { locale })}
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-navy-blue/76">
                {m.landingTtrpgText({}, { locale })}
              </p>
              <div className="mt-6 rounded-[1.75rem] border border-burned-orange/16 bg-white px-6 py-5 shadow-[0_24px_60px_-42px_rgba(0,2,79,0.48)]">
                <p className="text-sm leading-7 text-navy-blue/82">
                  {m.landingTtrpgDetail({}, { locale })}
                </p>
              </div>
              <Button
                asChild
                className="mt-7 h-12 px-7 text-sm uppercase tracking-[0.08em]"
              >
                <Link href={contactHref}>
                  {m.landingTtrpgCta({}, { locale })}
                </Link>
              </Button>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {ttrpgFeatures.map((feature, index) => (
                <Card
                  key={feature.label}
                  className={cn(
                    "rounded-[1.75rem] border-white/20 shadow-[0_28px_70px_-44px_rgba(0,2,79,0.55)]",
                    index === 1
                      ? "bg-navy-blue text-white md:translate-y-10"
                      : "bg-white"
                  )}
                >
                  <CardHeader>
                    <CardTitle
                      className={index === 1 ? "text-white" : undefined}
                    >
                      {feature.label}
                    </CardTitle>
                    <CardDescription
                      className={index === 1 ? "text-white/72" : undefined}
                    >
                      {feature.text}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section id={eventsSectionId} className="bg-white py-20 sm:py-24">
        <Container>
          <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr]">
            <Card className="rounded-[2rem] border-burned-orange/16 bg-[linear-gradient(160deg,#fff4e8_0%,#ffffff_50%,#f3f2ef_100%)] shadow-[0_32px_80px_-54px_rgba(0,2,79,0.4)]">
              <CardHeader>
                <Badge>{m.landingEventsSectionLabel({}, { locale })}</Badge>
                <CardTitle className="text-4xl sm:text-5xl">
                  {m.landingEventsTitle({}, { locale })}
                </CardTitle>
                <CardDescription className="max-w-2xl text-base leading-8 text-navy-blue/76">
                  {m.landingEventsText({}, { locale })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {eventFeatures.map((feature) => (
                  <div
                    key={feature}
                    className="rounded-[1.5rem] border border-white/80 bg-white/92 px-5 py-4 text-sm leading-7 text-navy-blue/82 shadow-[0_14px_40px_-34px_rgba(0,2,79,0.5)]"
                  >
                    {feature}
                  </div>
                ))}
                <Button
                  asChild
                  className="mt-3 h-12 px-7 text-sm uppercase tracking-[0.08em]"
                >
                  <Link href={contactHref}>
                    {m.landingEventsCta({}, { locale })}
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <div className="grid gap-5">
              <Card className="rounded-[2rem] border-burned-orange/20 bg-burned-orange text-white shadow-[0_34px_80px_-45px_rgba(221,72,10,0.8)]">
                <CardHeader>
                  <div className="flex items-center gap-3 text-white/84">
                    <CalendarRange className="h-5 w-5" />
                    <p className="text-xs uppercase tracking-[0.24em]">
                      {m.landingUiEventsCateringTitle({}, { locale })}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-white/88">
                    {m.landingEventsFoodCallout({}, { locale })}
                  </p>
                </CardContent>
              </Card>

              <Card className="rounded-[2rem] border-white/10 bg-navy-blue text-white shadow-[0_34px_80px_-45px_rgba(0,2,79,0.76)]">
                <CardHeader>
                  <CardTitle className="text-white">
                    {m.landingEventsFullSpaceRentalTitle({}, { locale })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-white/74">
                    {m.landingEventsFullSpaceRentalDetail({}, { locale })}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
