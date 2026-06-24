import Image, { getImageProps } from "next/image";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import Arrow1 from "@/shared/components/icons/arrow-1";
import CornerAccent from "@/shared/components/icons/corner-accent";
import Understroke1 from "@/shared/components/icons/understroke-1";
import Understroke2 from "@/shared/components/icons/understroke-2";
import { Button } from "@/shared/components/ui/button";
import type { VariableStyle } from "@/shared/utils";
import cornerMask from "../images/corner.svg";
import heroImage from "../images/hero.jpeg";
import { LandingPageHeroScrollScene } from "./landing-page-hero-scroll-scene";
import { LandingPageHexagon } from "./landing-page-hexagon";
import { LandingPagePhotoCarouselBackgroundNoise } from "./landing-page-photo-carousel-section";

type LandingPageHeroSectionProps = {
  locale: Locale;
  overviewSectionId: string;
  reservationHref: string;
  eventsHref: string;
};

export const landingPageHeroVars: VariableStyle<"hero-bottom-section-height"> =
  {
    "--hero-bottom-section-height": "16rem",
  };

export function LandingPageHeroSection({
  locale,
  overviewSectionId,
  reservationHref,
  eventsHref,
}: LandingPageHeroSectionProps) {
  const { props: cornerMaskProps } = getImageProps({
    ...cornerMask,
    alt: "",
    width: 128,
    height: 128,
    priority: true,
  });

  const heroContent = (
    <>
      <h1 className="text-5xl leading-[0.95] text-balance sm:text-6xl lg:text-7xl">
        {m.landingHeroTitle({}, { locale })}
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-white/82 sm:text-xl">
        {m.landingHeroSubtitle({}, { locale })}
      </p>

      <div className="sm:mt-9 mt-20 flex w-full flex-col items-center justify-center gap-x-8 gap-y-16 sm:flex-row">
        <Button
          asChild
          className="relative h-14 rounded-lg bg-burned-orange px-8 text-base uppercase tracking-[0.08em] hover:bg-burned-orange/90"
        >
          <a href={eventsHref}>
            <Arrow1
              height="100"
              className="absolute bottom-6 right-full pr-4 text-white"
            />
            {m.landingHeroSecondaryCta({}, { locale })}
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
          <a href={reservationHref}>
            <CornerAccent
              width={40}
              className="absolute -left-4 -top-5"
              style={{ strokeWidth: "40px" }}
            />
            {m.landingHeroPrimaryCta({}, { locale })}
            <Understroke2
              width="80%"
              className="absolute top-full mt-2 right-0"
            />
          </a>
        </Button>
      </div>
    </>
  );

  const orangeMaskSection = (
    <div className="relative min-h-(--hero-bottom-section-height)">
      <div className="absolute inset-0 top-8">
        <div
          className="absolute left-0 top-0 h-32 w-32 bg-chilean-fire"
          style={{
            maskImage: `url(${cornerMaskProps.src})`,
            maskSize: "cover",
          }}
        >
          <LandingPagePhotoCarouselBackgroundNoise className="bg-bottom" />
        </div>
        <div className="absolute inset-x-0 bottom-0 top-[calc(8rem-3.075rem)] bg-chilean-fire">
          <LandingPagePhotoCarouselBackgroundNoise className="bg-bottom" />
        </div>
        <div
          className="absolute right-0 top-0 h-32 w-32 bg-chilean-fire rotate-y-180"
          style={{
            maskImage: `url(${cornerMaskProps.src})`,
            maskSize: "cover",
          }}
        >
          <LandingPagePhotoCarouselBackgroundNoise className="bg-bottom" />
        </div>
      </div>
    </div>
  );

  return (
    <LandingPageHeroScrollScene
      background={<Background />}
      bottomSection={orangeMaskSection}
      className="relative isolate min-h-screen overflow-hidden bg-navy-blue pt-[calc(var(--site-header-height)+6rem)] text-white"
      id={overviewSectionId}
    >
      {heroContent}
    </LandingPageHeroScrollScene>
  );
}

function Background() {
  return (
    <div className="absolute inset-0">
      <Image
        src={heroImage}
        alt="Deskohub workspace interior"
        fill
        priority
        className="object-cover object-right"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_center,rgba(0,2,79,0.2)_20%,rgba(0,2,79,0.8)_50%,rgba(0,2,79,0.8)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.08),transparent_22%),radial-gradient(circle_at_88%_20%,rgba(236,164,35,0.34),transparent_18%),radial-gradient(circle_at_64%_80%,rgba(221,72,10,0.22),transparent_22%)]" />
      <div className="absolute right-0 top-28 h-56 w-56 translate-x-1/4 rotate-45 rounded-[2.75rem] border border-white/10 bg-burned-orange/50 shadow-[0_20px_80px_-20px_rgba(221,72,10,0.95)]" />
      <div className="absolute right-28 top-30 h-20 w-20 rotate-45 rounded-[1.25rem] border border-white/12 bg-burned-orange/50" />
      <div className="absolute -left-18 top-[55%] h-30 w-40 -translate-y-1/2 text-sunset-yellow/60">
        <LandingPageHexagon />
      </div>
      {/* <div className="absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(180deg,transparent_0%,rgb(245,124,0)_100%)]" /> */}
    </div>
  );
}
