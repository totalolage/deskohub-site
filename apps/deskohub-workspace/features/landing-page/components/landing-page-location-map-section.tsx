import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceLocationMapImageOptions,
  workspaceLocationMapImagePath,
} from "@/shared/utils";
import { LandingPageLocationMapImage } from "./landing-page-location-map-image";

type LandingPageLocationMapSectionProps = {
  locale: Locale;
};

export function LandingPageLocationMapSection({
  locale,
}: LandingPageLocationMapSectionProps) {
  return (
    <section className="relative overflow-hidden bg-[#f4f1ea] text-navy-blue">
      <div className="relative min-h-184 lg:min-h-136">
        <LandingPageLocationMapImage
          alt={m.landingLocationMapAlt({}, { locale })}
          height={workspaceLocationMapImageOptions.height}
          src={workspaceLocationMapImagePath}
          width={workspaceLocationMapImageOptions.width}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(244,241,234,0.98)_0%,rgba(244,241,234,0.84)_36%,rgba(244,241,234,0.14)_78%,rgba(244,241,234,0)_100%)] lg:bg-[linear-gradient(90deg,rgba(244,241,234,0.96)_0%,rgba(244,241,234,0.82)_38%,rgba(244,241,234,0.18)_100%)]" />

        <Container className="relative z-10 flex min-h-184 items-start py-8 lg:min-h-136 lg:items-end lg:py-10">
          <div className="max-w-xl rounded-4xl border border-navy-blue/10 bg-[#f4f1ea]/95 p-6 shadow-[0_34px_90px_-55px_rgba(0,2,79,0.75)] backdrop-blur sm:p-8">
            <h2 className="text-4xl leading-tight text-balance sm:text-5xl">
              {m.landingLocationMapTitle({}, { locale })}
            </h2>
            <address className="mt-6 not-italic text-lg font-semibold leading-7">
              {workspaceFormattedAddress}
            </address>
            <Button
              asChild
              className="mt-7 h-12 px-7 uppercase tracking-[0.08em]"
            >
              <a
                href={workspaceGoogleDirectionsUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                {m.landingLocationMapCta({}, { locale })}
              </a>
            </Button>
          </div>
        </Container>
      </div>
    </section>
  );
}
