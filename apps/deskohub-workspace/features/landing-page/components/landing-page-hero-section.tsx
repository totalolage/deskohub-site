import { DoorOpen, type LucideIcon, MapPin, Sparkles } from "lucide-react";
import Image, { getImageProps } from "next/image";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import Arrow1 from "@/shared/components/icons/arrow-1";
import CornerAccent from "@/shared/components/icons/corner-accent";
import Understroke1 from "@/shared/components/icons/understroke-1";
import Understroke2 from "@/shared/components/icons/understroke-2";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";
import cornerMask from "../images/corner.svg";
import heroImage from "../images/hero.jpeg";
import { LandingPageHexagon } from "./landing-page-hexagon";
import { LandingPageUniverseBackgroundNoise } from "./landing-page-universe-section";

type LandingPageHeroSectionProps = {
  locale: Locale;
  overviewSectionId: string;
  pricingHref: string;
  eventsHref: string;
};

export function LandingPageHeroSection({
  locale,
  overviewSectionId,
  pricingHref,
  eventsHref,
}: LandingPageHeroSectionProps) {
  const heroHighlights: Array<{
    icon: LucideIcon;
    label: string;
    text: string;
  }> = [
    {
      icon: DoorOpen,
      label: m.landingHeroStatOneLabel({}, { locale }),
      text: m.landingHeroStatOneValue({}, { locale }),
    },
    {
      icon: Sparkles,
      label: m.landingHeroStatTwoLabel({}, { locale }),
      text: m.landingHeroStatTwoValue({}, { locale }),
    },
    {
      icon: MapPin,
      label: m.landingHeroStatThreeLabel({}, { locale }),
      text: m.landingHeroStatThreeValue({}, { locale }),
    },
  ];

  const { props: cornerMaskProps } = getImageProps({
    ...cornerMask,
    width: 128,
    height: 128,
    priority: true,
  });

  return (
    <section
      id={overviewSectionId}
      className={cn(
        "relative isolate min-h-screen mt-[var(--site-header-height)] overflow-hidden bg-navy-blue pt-24 text-white",
        "[--stats-peek-height:16rem]"
      )}
    >
      <Background />

      <Container className="mx-auto flex min-h-[calc(100vh-var(--site-header-height)-var(--stats-peek-height))] w-full flex-col items-center justify-center pb-28 text-center">
        <h1 className="z-1 text-5xl leading-[0.95] text-balance sm:text-6xl lg:text-7xl">
          {m.landingHeroTitle({}, { locale })}
        </h1>
        <p className="z-1 mt-6 max-w-xl text-lg leading-8 text-white/82 sm:text-xl">
          {m.landingHeroSubtitle({}, { locale })}
        </p>

        <div className="sm:mt-9 mt-20 flex w-full flex-col items-center justify-center gap-x-8 gap-y-16 sm:flex-row">
          <Button
            asChild
            className="relative h-14 rounded-lg bg-burned-orange px-8 text-base uppercase tracking-[0.08em] hover:bg-burned-orange/90"
          >
            <a href={pricingHref}>
              <Arrow1
                height="100"
                className="absolute bottom-6 right-full pr-4 text-white"
              />
              {m.landingHeroPrimaryCta({}, { locale })}
              <Understroke1
                width="100%"
                className="absolute top-full mt-2 left-1/2 -translate-x-1/2 rotate-x-180 text-white"
              />
            </a>
          </Button>
          <Button
            asChild
            variant="secondary"
            className="relative h-14 rounded-lg border-burned-orange bg-white/92 px-8 text-base uppercase tracking-[0.08em] text-burned-orange hover:bg-white"
          >
            <a href={eventsHref}>
              <CornerAccent
                width={40}
                className="absolute -left-4 -top-5"
                style={{ strokeWidth: "40px" }}
              />
              {m.landingHeroSecondaryCta({}, { locale })}
              <Understroke2
                width="80%"
                className="absolute top-full mt-2 right-0"
              />
            </a>
          </Button>
        </div>
      </Container>

      <div className="relative min-h-[var(--stats-peek-height)]">
        <Card className="relative z-10 mx-auto bg-navy-blue max-w-fit">
          <CardHeader>
            <CardTitle className="text-white text-center">
              {m.landingUiHeroStatsTitle({}, { locale })}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-4 justify-around">
            {heroHighlights.map((highlight) => (
              <div key={highlight.label} className="px-4 py-4">
                <div className="flex items-center gap-2 text-sm leading-6 text-white/84">
                  <highlight.icon className="h-5 w-5 shrink-0 text-sunset-yellow" />
                  <p>{highlight.label}</p>
                </div>
                <p className="mt-3 text-xl font-medium leading-tight text-white">
                  {highlight.text}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="absolute inset-0 top-8">
          <div
            className="absolute left-0 top-0 h-32 w-32 bg-chilean-fire"
            style={{
              maskImage: `url(${cornerMaskProps.src})`,
              maskSize: "cover",
            }}
          >
            <LandingPageUniverseBackgroundNoise className="bg-bottom" />
          </div>
          <div className="absolute inset-x-0 bottom-0 top-[calc(8rem-3.075rem)] bg-chilean-fire">
            <LandingPageUniverseBackgroundNoise className="bg-bottom" />
          </div>
          <div
            className="absolute right-0 top-0 h-32 w-32 bg-chilean-fire rotate-y-180"
            style={{
              maskImage: `url(${cornerMaskProps.src})`,
              maskSize: "cover",
            }}
          >
            <LandingPageUniverseBackgroundNoise className="bg-bottom" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Background() {
  return (
    <div className="-z-1">
      <Image
        src={heroImage}
        alt="Deskohub workspace interior"
        fill
        priority
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_center,rgba(0,2,79,0.2)_20%,rgba(0,2,79,0.8)_50%,rgba(0,2,79,0.8)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.08),transparent_22%),radial-gradient(circle_at_88%_20%,rgba(236,164,35,0.34),transparent_18%),radial-gradient(circle_at_64%_80%,rgba(221,72,10,0.22),transparent_22%)]" />
      <div className="absolute right-0 top-28 h-56 w-56 translate-x-1/4 rotate-45 rounded-[2.75rem] border border-white/10 bg-burned-orange/50 shadow-[0_20px_80px_-20px_rgba(221,72,10,0.95)]" />
      <div className="absolute right-28 top-30 h-20 w-20 rotate-45 rounded-[1.25rem] border border-white/12 bg-burned-orange/50" />
      <div className="absolute left-[-4.5rem] top-[55%] h-30 w-40 -translate-y-1/2 text-sunset-yellow/60">
        <LandingPageHexagon />
      </div>
      {/* <div className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,transparent_0%,rgb(245,124,0)_100%)]" /> */}
    </div>
  );
}
