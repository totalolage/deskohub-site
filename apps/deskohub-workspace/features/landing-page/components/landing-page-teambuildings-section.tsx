import { ArrowRight, Blend, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import type { Locale } from "@/features/i18n";
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

type LandingPageTeambuildingsSectionProps = {
  locale: Locale;
  teambuildingsSectionId: string;
  contactHref: string;
};

export function LandingPageTeambuildingsSection({
  locale,
  teambuildingsSectionId,
  contactHref,
}: LandingPageTeambuildingsSectionProps) {
  const teambuildingHighlights = [
    {
      icon: Users,
      title: m.landingTeambuildingsFeatureOneTitle({}, { locale }),
      text: m.landingTeambuildingsFeatureOneText({}, { locale }),
    },
    {
      icon: Blend,
      title: m.landingTeambuildingsFeatureTwoTitle({}, { locale }),
      text: m.landingTeambuildingsFeatureTwoText({}, { locale }),
    },
    {
      icon: Sparkles,
      title: m.landingTeambuildingsFeatureThreeTitle({}, { locale }),
      text: m.landingTeambuildingsFeatureThreeText({}, { locale }),
    },
  ];

  return (
    <section id={teambuildingsSectionId} className="bg-white py-20 sm:py-24">
      <Container>
        <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-start">
          <Card className="rounded-4xl border-white/12 bg-[linear-gradient(145deg,rgba(255,247,236,0.98)_0%,rgba(255,255,255,0.97)_40%,rgba(241,232,214,0.96)_100%)] shadow-[0_38px_95px_-54px_rgba(0,0,0,0.55)] backdrop-blur-sm">
            <CardHeader>
              <Badge>
                {m.landingTeambuildingsSectionLabel({}, { locale })}
              </Badge>
              <CardTitle className="text-4xl leading-tight sm:text-5xl">
                {m.landingTeambuildingsTitle({}, { locale })}
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-8 text-navy-blue/76">
                {m.landingTeambuildingsText({}, { locale })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-4 md:grid-cols-3">
                {teambuildingHighlights.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-[1.6rem] border border-burned-orange/12 bg-white/90 p-5 shadow-[0_16px_48px_-34px_rgba(0,2,79,0.35)]"
                  >
                    <div className="flex gap-4">
                      <item.icon className="h-5 w-5 text-sunset-yellow" />
                      <p className="text-lg font-medium text-navy-blue">
                        {item.title}
                      </p>
                    </div>
                    <p className="mt-2 text-sm leading-7 text-navy-blue/74">
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>

              <Button
                asChild
                className="h-12 px-7 text-sm uppercase tracking-[0.08em]"
              >
                <Link href={contactHref}>
                  {m.landingTeambuildingsCta({}, { locale })}
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-4xl border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.05)_100%)] shadow-[0_34px_90px_-45px_rgba(0,0,0,0.65)] backdrop-blur-md">
            <CardHeader>
              <Badge className="border-white/12 bg-white/8">
                {m.landingUiTeamPerksTitle({}, { locale })}
              </Badge>
              <CardTitle className="text-3xl leading-tight sm:text-[2.4rem]">
                {m.landingTeambuildingsSideTitle({}, { locale })}
              </CardTitle>
              <CardDescription className="leading-8 text-base">
                {m.landingTeambuildingsSideText({}, { locale })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(236,164,35,0.14)_0%,rgba(255,255,255,0.06)_100%)] p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-sunset-yellow/82">
                  {m.landingTeambuildingsCapacityLabel({}, { locale })}
                </p>
                <p className="mt-2 text-2xl font-medium">
                  {m.landingTeambuildingsCapacityValue({}, { locale })}
                </p>
                <p className="mt-3 text-sm leading-7">
                  {m.landingTeambuildingsCapacityText({}, { locale })}
                </p>
              </div>

              <Link
                href={contactHref}
                className="group flex items-center justify-between rounded-3xl border border-white/10 bg-white/4 px-5 py-4 text-sm leading-7 transition-colors hover:bg-white/10"
              >
                <span>
                  {m.landingTeambuildingsInquiryPrompt({}, { locale })}
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-sunset-yellow transition-transform group-hover:translate-x-1" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </Container>
    </section>
  );
}
