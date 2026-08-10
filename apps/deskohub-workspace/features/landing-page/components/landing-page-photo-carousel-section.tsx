import { connection } from "next/server";
import { Suspense } from "react";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { Container } from "@/shared/components/container";
import { cn } from "@/shared/utils";
import noiseTexture from "../images/noise-texture.png";
import { LandingPageHexagon } from "./landing-page-hexagon";
import { LandingPagePhotoCarousel } from "./landing-page-photo-carousel";

const landingPagePhotoCarouselLabel = "Deskohub workspace photo carousel";

export const LandingPagePhotoCarouselBackgroundNoise = ({
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

export function LandingPagePhotoCarouselSection() {
  return (
    <section
      id="hero-gallery"
      className={cn(
        "relative py-16 sm:py-20 lg:py-24",
        "mt-[calc(-0.5*var(--hero-bottom-section-height))]",
        "bg-[linear-gradient(var(--color-chilean-fire)_0%,transparent_100%),conic-gradient(from_225deg_at_30%_10%,#F57D00,#FF9222)] bg-bottom-left"
      )}
    >
      <LandingPagePhotoCarouselBackgroundNoise className="bg-top" />

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
        <Suspense fallback={<LandingPagePhotoCarouselFallback />}>
          <LandingPagePhotoCarouselContent />
        </Suspense>
      </Container>
    </section>
  );
}

async function LandingPagePhotoCarouselContent() {
  await connection();
  const images = await getCloudinaryImages({
    tags: ["landing-carousel"],
    maxResults: 20,
  });

  return (
    <LandingPagePhotoCarousel
      ariaLabel={landingPagePhotoCarouselLabel}
      images={images}
    />
  );
}

function LandingPagePhotoCarouselFallback() {
  return (
    <section
      aria-busy="true"
      aria-label={landingPagePhotoCarouselLabel}
      className="overflow-visible space-y-8"
    >
      <div className="relative mx-auto h-72 max-w-6xl sm:h-112 lg:h-136">
        <div className="absolute left-1/2 top-1/2 aspect-16/10 w-[min(78%,54rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[1.8rem] border border-white/35 bg-white/18 p-2 shadow-[0_30px_90px_-48px_rgba(0,2,79,0.95)] backdrop-blur-sm sm:rounded-[2.5rem] sm:p-3">
          <div className="size-full animate-pulse rounded-[1.25rem] bg-linear-to-br from-navy-blue/82 via-navy-blue/48 to-sunset-yellow/36 motion-reduce:animate-none sm:rounded-[1.85rem]" />
        </div>
      </div>
      <div aria-hidden="true" className="flex justify-center gap-2">
        <span className="size-2 rounded-full bg-navy-blue" />
        <span className="size-2 rounded-full bg-navy-blue/28" />
        <span className="size-2 rounded-full bg-navy-blue/28" />
      </div>
    </section>
  );
}
