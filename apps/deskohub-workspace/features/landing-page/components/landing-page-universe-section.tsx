import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";
import noiseTexture from "../images/noise-texture.png";
import { LandingPageHexagon } from "./landing-page-hexagon";

type LandingPageUniverseSectionProps = {
  locale: WorkspaceLocale;
};

export const LandingPageUniverseBackgroundNoise = ({
  className,
}: {
  className?: string;
}) => (
  <div
    aria-hidden="true"
    className={cn(
      "pointer-events-none absolute inset-0 bg-repeat opacity-20",
      className
    )}
    style={{
      backgroundImage: `url(${noiseTexture.src})`,
      backgroundSize: "500px 500px",
    }}
  />
);

export function LandingPageUniverseSection({
  locale,
}: LandingPageUniverseSectionProps) {
  const overviewCards = [
    {
      title: m.landingRozcestnikBarTitle({}, { locale }),
      text: m.landingRozcestnikBarText({}, { locale }),
      className: "border-burned-orange/20 bg-white text-navy-blue",
    },
    {
      title: m.landingRozcestnikWorkspaceTitle({}, { locale }),
      text: m.landingRozcestnikWorkspaceText({}, { locale }),
      className: "border-white/10 bg-navy-blue text-white",
    },
  ];

  return (
    <section className={cn( "relative overflow-hidden py-16 sm:py-20 lg:py-24",
"bg-[linear-gradient(var(--color-chilean-fire)_0%,transparent_100%),conic-gradient(from_225deg_at_30%_10%,#F57D00,#FF9222)] bg-bottom-left"
    )}>
      <LandingPageUniverseBackgroundNoise className="bg-top" />

      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-10 top-1/2 h-36 w-40 -translate-y-1/2 text-navy-blue/30">
          <LandingPageHexagon />
        </div>
        <div className="absolute bottom-12 left-16 h-14 w-14 rotate-45 rounded-2xl bg-navy-blue" />
        <div className="absolute bottom-24 left-32 h-9 w-9 rotate-45 rounded-xl bg-navy-blue" />
        <div className="absolute right-24 top-12 h-18 w-18 rotate-45 rounded-[1.6rem] bg-black/10" />
        <div className="absolute bottom-8 right-0 h-32 w-64">
          <div className="absolute bottom-5 right-8 h-1 w-48 rotate-[-30deg] bg-navy-blue" />
          <div className="absolute bottom-14 right-16 h-1 w-32 rotate-[-30deg] bg-navy-blue" />
        </div>
      </div>

      <Container className="relative z-10">
        <div className="text-center">
          <h2 className="text-3xl text-navy-blue sm:text-4xl">
            {m.landingUniversumTitle({}, { locale })}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-navy-blue/78">
            {m.landingUniversumLead({}, { locale })}
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {overviewCards.map((card) => (
            <Card
              key={card.title}
              className={cn("rounded-[1.75rem]", card.className)}
            >
              <CardHeader>
                <CardTitle
                  className={
                    card.className.includes("text-white")
                      ? "text-white"
                      : undefined
                  }
                >
                  {card.title}
                </CardTitle>
                <CardDescription
                  className={
                    card.className.includes("text-white")
                      ? "text-white/72"
                      : "text-navy-blue/76"
                  }
                >
                  {card.text}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </Container>
    </section>
  );
}
